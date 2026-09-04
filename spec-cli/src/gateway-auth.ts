import { createHmac, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spexcodeHome } from '@spexcode/spec-core'

export type Verifier = { algo: 'scrypt'; N: number; r: number; p: number; salt: string; hash: string; gen: string }
export type PeerGrant = { machineId: string; gen: string; createdAt: number }
export type AuthStore = { v: 1; secret: string; admin?: Verifier; projects: Record<string, Verifier>; peers: Record<string, PeerGrant> }
export type Scope = { s: 'admin' } | { s: 'project'; p: string } | { s: 'peer'; m: string }
export type Claims = { v: 1; s: 'admin' | 'project' | 'peer'; p?: string; m?: string; g: string; t: number }
export type Decision =
  | { ok: true; via: 'admin' | 'project' | 'open' | 'loopback' | 'peer'; machineId?: string }
  | { ok: false; reason: 'admin-login' | 'locked' | 'project-login' | 'peer-credential' }
// Which LISTENER a request arrived on. A forwarded socket and a console socket are the same loopback
// address, so nothing IN the request can separate them; the entry is the one fact the caller cannot forge.
export type Entry = 'console' | 'peer'

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000 // matches the single-project gateway's 30-day cookie
const SCRYPT = { N: 16384, r: 8, p: 1 } as const

// ---- the private per-user store --------------------------------------------------------------------

export function authStorePath(): string {
  return join(spexcodeHome(), 'gateway', 'auth.json')
}

// first load creates the store (and its random signing secret) so sessions survive restarts; the file is
// 0600 in a 0700 dir — this is a per-USER secret store, no other principal has business reading it.
export function loadAuthStore(): AuthStore {
  try {
    const raw = JSON.parse(readFileSync(authStorePath(), 'utf8'))
    if (raw?.v === 1 && typeof raw.secret === 'string' && raw.secret) return { v: 1, secret: raw.secret, admin: raw.admin, projects: raw.projects ?? {}, peers: raw.peers ?? {} }
  } catch { /* absent or unreadable → fresh below; malformed secrets must not be half-trusted */ }
  const fresh: AuthStore = { v: 1, secret: randomBytes(32).toString('base64url'), projects: {}, peers: {} }
  saveAuthStore(fresh)
  return fresh
}

function saveAuthStore(store: AuthStore): void {
  const file = authStorePath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, file)
  chmodSync(file, 0o600) // rename preserves the tmp mode, but never let a pre-existing looser file win
}

// ---- password verifiers (scrypt, salted, constant-time) --------------------------------------------

export function makeVerifier(password: string): Verifier {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, SCRYPT)
  return { algo: 'scrypt', ...SCRYPT, salt: salt.toString('base64url'), hash: hash.toString('base64url'), gen: randomBytes(8).toString('base64url') }
}

export function verifyPassword(v: Verifier | undefined, password: string): boolean {
  if (!v || v.algo !== 'scrypt' || typeof password !== 'string') return false
  const got = scryptSync(password, Buffer.from(v.salt, 'base64url'), 32, { N: v.N, r: v.r, p: v.p })
  return constEq(got, Buffer.from(v.hash, 'base64url'))
}

function constEq(a: Buffer | string, b: Buffer | string): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a)
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

// ---- verifier management (the gateway admin APIs write through these) ------------------------------

export function setAdminPassword(password: string): AuthStore {
  const store = loadAuthStore()
  store.admin = makeVerifier(password)
  saveAuthStore(store)
  return store
}
export function clearAdminPassword(): AuthStore {
  const store = loadAuthStore()
  delete store.admin
  saveAuthStore(store)
  return store
}
export function setProjectPassword(projectId: string, password: string): AuthStore {
  const store = loadAuthStore()
  store.projects[projectId] = makeVerifier(password)
  saveAuthStore(store)
  return store
}
export function clearProjectPassword(projectId: string): AuthStore {
  const store = loadAuthStore()
  delete store.projects[projectId]
  saveAuthStore(store)
  return store
}

// ---- peer grants ------------------------------------------------------------------------------------
// A peer credential is ISSUED, not inherited: it names one machine id and there is no password behind it —
// the SSH-authenticated accept handshake IS the authentication, and this is the credential it hands back.
// Granting is idempotent in the GENERATION: re-accepting hands that machine a fresh token on the same gen,
// so an ordinary refresh never invalidates the credential the caller already holds. Only `revokePeer`
// destroys the generation, and destroying it is what ends every token that machine was ever handed.

export function grantPeer(machineId: string, nowMs = Date.now()): { store: AuthStore; token: string } {
  const store = loadAuthStore()
  store.peers[machineId] ??= { machineId, gen: randomBytes(8).toString('base64url'), createdAt: nowMs }
  saveAuthStore(store)
  return { store, token: mintToken(store, { s: 'peer', m: machineId }, nowMs) }
}

export function revokePeer(machineId: string): AuthStore {
  const store = loadAuthStore()
  delete store.peers[machineId]
  saveAuthStore(store)
  return store
}

export function listPeerGrants(store = loadAuthStore()): PeerGrant[] {
  return Object.values(store.peers).sort((a, b) => a.machineId.localeCompare(b.machineId))
}

// ---- signed session tokens --------------------------------------------------------------------------

function sign(secret: string, payload: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('base64url')
}

// a token exists only for a scope that has a verifier — its `g` claim is that verifier's current gen.
export function mintToken(store: AuthStore, scope: Scope, nowMs = Date.now()): string {
  const gen = scope.s === 'admin' ? store.admin?.gen : scope.s === 'project' ? store.projects[scope.p]?.gen : store.peers[scope.m]?.gen
  if (!gen) throw new Error(`gateway-auth: cannot mint a ${scope.s} token with no verifier configured`)
  const claims: Claims = { v: 1, s: scope.s, ...(scope.s === 'project' ? { p: scope.p } : scope.s === 'peer' ? { m: scope.m } : {}), g: gen, t: nowMs }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(store.secret, payload)}`
}

// full validity lives here: signature (constant-time), shape, expiry, and the gen check against the
// CURRENT verifier — a cleared or re-set password leaves no valid tokens behind.
export function verifyToken(store: AuthStore, token: string, nowMs = Date.now()): Claims | null {
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot), sig = token.slice(dot + 1)
  if (!constEq(sig, sign(store.secret, payload))) return null
  let claims: Claims
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
  if (claims?.v !== 1 || typeof claims.t !== 'number' || typeof claims.g !== 'string') return null
  if (nowMs > claims.t + TOKEN_TTL_MS || claims.t > nowMs + 60_000) return null
  if (claims.s === 'admin') return store.admin && constEq(claims.g, store.admin.gen) ? claims : null
  if (claims.s === 'project' && typeof claims.p === 'string') {
    const v = store.projects[claims.p]
    return v && constEq(claims.g, v.gen) ? claims : null
  }
  // a peer's gen lives in its own grant, so revoking one machine leaves every other machine's credential
  // valid and leaves no valid credential for the machine that was dropped.
  if (claims.s === 'peer' && typeof claims.m === 'string') {
    const grant = store.peers[claims.m]
    return grant && constEq(claims.g, grant.gen) ? claims : null
  }
  return null
}

// ---- cookies ----------------------------------------------------------------------------------------
// Cookie names are keyed by the gateway's public port (cookies are host-scoped; the port is the
// discriminator — same rationale as the single-project gateway) and, for project scopes, by a hash of the
// projectId (ids are path-derived and may hold non-token chars). The NAME is only a mailbox: authorization
// always re-validates the token's own projectId claim against the requested route — never the cookie's
// name, and never its Path attribute, both of which are client-controlled.

export function adminCookieName(port: number): string { return `spex_admin_${port}` }
export function projectCookieName(port: number, projectId: string): string {
  return `spex_proj_${port}_${createHash('sha256').update(projectId).digest('hex').slice(0, 12)}`
}

export function cookieOf(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

// ---- loopback ---------------------------------------------------------------------------------------
// The implicit-admin decision reads the SOCKET's remote address only. Never a header (X-Forwarded-For,
// X-Real-IP): headers are attacker-controlled, and this gateway is designed to face the internet directly,
// not to sit behind a trusted proxy.
export function isLoopback(addr: string | null | undefined): boolean {
  if (!addr) return false
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  return a === '::1' || /^127(\.\d{1,3}){3}$/.test(a)
}

// ---- the decision -----------------------------------------------------------------------------------

export type Route = { kind: 'admin' } | { kind: 'project'; projectId: string }

// A peer credential travels as a HEADER, never a cookie: it belongs to the calling machine, not to the
// browser being proxied, and a cookie would be attached to unrelated requests by the visitor's own agent.
export const PEER_CREDENTIAL_HEADER = 'x-spex-peer-credential'

export function authorize(store: AuthStore, route: Route, cookieHeader: string | undefined, remoteAddr: string | null | undefined, port: number, entry: Entry = 'console', peerToken?: string | null): Decision {
  // The peer ingress is a different door, so it decides first and alone. Implicit loopback trust is never
  // granted here: a machine has no console, and its socket is loopback only because a forward made it so.
  // Cookies arriving on this entry belong to the far side's visitor and settle nothing about the machine.
  if (entry === 'peer') {
    const claims = peerToken ? verifyToken(store, peerToken) : null
    if (claims?.s === 'peer' && typeof claims.m === 'string') return { ok: true, via: 'peer', machineId: claims.m }
    return { ok: false, reason: 'peer-credential' }
  }

  const adminTok = cookieOf(cookieHeader, adminCookieName(port))
  const adminClaims = adminTok ? verifyToken(store, adminTok) : null
  const adminOk = adminClaims?.s === 'admin'

  if (route.kind === 'admin') {
    if (adminOk) return { ok: true, via: 'admin' }
    // no admin verifier configured: loopback manages implicitly (the bootstrap path — set the first
    // password from the machine itself); anyone else finds /projects locked, not open.
    if (!store.admin) return isLoopback(remoteAddr) ? { ok: true, via: 'loopback' } : { ok: false, reason: 'locked' }
    return { ok: false, reason: 'admin-login' }
  }

  // project route — admin reaches every project; then the project's own gate decides.
  if (adminOk) return { ok: true, via: 'admin' }
  if (!store.projects[route.projectId]) return { ok: true, via: 'open' }
  const tok = cookieOf(cookieHeader, projectCookieName(port, route.projectId))
  const claims = tok ? verifyToken(store, tok) : null
  // the projectId CLAIM must match the route — presenting project A's token under project B's cookie
  // name (or any Path trick) authorizes nothing.
  if (claims?.s === 'project' && claims.p === route.projectId) return { ok: true, via: 'project' }
  return { ok: false, reason: 'project-login' }
}
