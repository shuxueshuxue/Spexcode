// @@@ gateway hub - the multi-project face of [[public-mode]]: ONE gateway fronting every project backend
// this user runs. The backends stay loopback internal services (each `spex serve` records its endpoint in
// ~/.spexcode/projects/<enc>/backend.json — that record IS the hub's registry); the hub terminates the
// outside world, decides authorization ([[gateway-auth]] — the single mechanism, two signed scopes), and
// reverse-proxies into the matching loopback backend with the gateway's own cookies STRIPPED, so a backend
// never sees a credential.
//
// The route contract:
//   /login /logout                      admin session (the designed login page)
//   GET /projects                       admin: list the registry (+ gating state); with a host shell
//                                       mounted, an explicit text/html GET gets the Projects UI instead
//   PUT|DELETE /projects/admin-password admin: set/clear the admin password
//   PUT|DELETE /projects/:id/password   admin: set/clear one project's password
//   DELETE /projects/:id                host extension: high-friction catalog registration removal
//   /p/:projectId/login|logout          project session for that project
//   ANY /p/:projectId/*  (+ WS upgrade) authorized → proxied, prefix-stripped, to that project's backend
//   GET /machines                       admin: this machine's id + the peered machines and their legs
//   ANY /m/:machineId/*  (+ WS upgrade) admin → proxied, segment-stripped, to that machine's gateway
// Authorization never trusts the cookie's name or Path — the token's projectId claim is validated against
// the :projectId in the URL on every request (see gateway-auth.ts).
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  adminCookieName, authorize, clearAdminPassword, clearProjectPassword, loadAuthStore, mintToken,
  projectCookieName, setAdminPassword, setProjectPassword, verifyPassword, PEER_CREDENTIAL_HEADER,
  type AuthStore, type Entry,
} from './gateway-auth.js'
import { loginPage } from './login-page.js'
import { listenOrExit } from './listen.js'
import { installConnectionReaper } from './reaper.js'
import { spexcodeHome, encodeProject } from '@spexcode/spec-core'
import { readEndpointRecord } from './endpoint-record.js'
import { readGatewayIdentity, type ResolvedIdentity } from '@spexcode/spec-core'
import { proxyHttp, proxySessionWeb, proxySessionWebUpgrade } from './gateway.js'
import { listMachinePeers, readPeerMachineId, type MachinePeer } from './machine-peer.js'

export type HubProject = { id: string; identity: ResolvedIdentity; url: string; port: number; gated: boolean }
// @@@ extension seam - the hub stays the ONE routing+authorization server; a host-level caller
// ([[host-gateway]]'s `spex dashboard`) plugs richer behavior in here instead of running a second
// gateway beside it. All three hooks are optional; bare startHubGateway behavior is unchanged.
export type HubExtensions = {
  // enriched GET /projects rows (reconciled online/offline entries + the durable catalog); the hub
  // still owns the envelope ({adminGated, projects}) and the admin gate in front of it.
  listProjects?: (store: AuthStore) => Promise<object[]> | object[]
  // extra ADMIN-scope routes under /projects/* (stream, registration, project operations) — called only
  // AFTER admin authorization, for /projects paths the hub itself doesn't handle. True = handled.
  adminRoute?: (req: http.IncomingMessage, res: http.ServerResponse, path: string) => Promise<boolean> | boolean
  // host-level reads outside the project catalog, still behind the same admin scope.
  hostRoute?: (req: http.IncomingMessage, res: http.ServerResponse, path: string) => Promise<boolean> | boolean
  // paths the hub would 404 (everything outside /projects, /p, /login) — the dashboard SPA shell +
  // assets. Unauthorized by design: the shell is code, not data; every data call it makes re-enters
  // the authorized routes.
  fallback?: (req: http.IncomingMessage, res: http.ServerResponse, path: string) => void
}
// `entry` is which LISTENER this server is: the console entry a human reaches, or the peer ingress a
// linked machine's forward lands on. It is a property of the SOCKET, chosen here at construction, never
// read from a request — see [[gateway-auth]]. A peer-ingress server is bound to loopback by its caller
// and `--host` has no say in it.
export type HubOpts = { port: number; host: string; tls?: { cert: string; key: string } | null; label?: string; onBindFail?: () => void; onListen?: (port: number) => void; extensions?: HubExtensions; entry?: Entry }

// ---- registry ---------------------------------------------------------------------------------------
// A project = a live backend record under ~/.spexcode/projects/<enc>/backend.json (written by supervise.ts
// at bind time). The <enc> dir name is the projectId. ONE record-read seam ([[host-gateway]]'s
// readEndpointRecord — the identity-carrying shape): a legacy or torn record is not routable, and a record
// sitting in a slot its own root does not encode to is not trusted. Only LOOPBACK upstream urls are
// honored — the hub proxies into this machine's trust boundary, never out to an arbitrary host a crafted
// record names.

function upstreamOf(id: string): { url: string; port: number; root: string; identity: ResolvedIdentity } | null {
  const rec = readEndpointRecord(join(spexcodeHome(), 'projects', id, 'backend.json'))
  if (!rec || encodeProject(rec.root) !== id) return null
  let u: URL
  try { u = new URL(rec.url) } catch { return null }
  if (u.protocol !== 'http:' || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) {
    console.error(`[hub] ignoring project '${id}': backend url ${rec.url} is not a loopback http endpoint`)
    return null
  }
  const port = Number(u.port || 80)
  if (!Number.isInteger(port) || port <= 0) return null
  return { url: rec.url, port, root: rec.root, identity: rec.identity }
}

// a projectId or machineId arrives as ONE url path segment; reject anything that could re-shape the registry
// path (a projectId indexes a directory) or the peer lookup.
function validProjectId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && id !== '.' && id !== '..' &&
    !id.includes('/') && !id.includes('\\') && !id.includes('\0')
}

export function listHubProjects(store: AuthStore): HubProject[] {
  const dir = join(spexcodeHome(), 'projects')
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { /* no projects yet */ }
  const out: HubProject[] = []
  for (const id of entries) {
    const up = upstreamOf(id)
    if (!up) continue
    out.push({ id, identity: up.identity, url: up.url, port: up.port, gated: !!store.projects[id] })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// ---- the machine registry ---------------------------------------------------------------------------
// The machine dimension is ADDRESSING, never aggregation ([[machine-routing]]): this hub answers for its own
// machine and forwards `/m/:machineId/*` into a peered machine's gateway, so one origin, one SPA and one set
// of deep links reach the whole fleet while `/p/:projectId/*` keeps meaning THIS machine forever.
export type MachineRow = { machineId: string; sshAddress: string; state: MachinePeer['state']; gateway: boolean; lastError: string | null }
type MachineLeg = { port: number; credential: string }

// Two different absences, answered differently, because they tell an operator different things: a machine
// nobody here is linked to at all, versus a linked machine that publishes no gateway (its own is down, or its
// host record predates the peer ingress — [[host-facts]]).
function findMachine(machineId: string): MachinePeer | null {
  return listMachinePeers().find((p) => p.machineId === machineId) ?? null
}

// A peer is ADDRESSABLE here only with both halves of its leg: the local forwarded port and the credential
// that machine issued to this one. Either missing is an honest "no gateway on that machine" — never a guessed
// port and never a credential-less forward into a console entry, which is the laundering [[machine-routing]]
// outlaws.
function legOf(peer: MachinePeer): MachineLeg | null {
  if (!peer.gatewayPort || !peer.remoteGatewayCredential) return null
  return { port: peer.gatewayPort, credential: peer.remoteGatewayCredential }
}

export function listMachineRows(): MachineRow[] {
  return listMachinePeers()
    .map((peer) => ({
      machineId: peer.machineId, sshAddress: peer.sshAddress, state: peer.state,
      gateway: !!(peer.gatewayPort && peer.remoteGatewayCredential), lastError: peer.lastError,
    }))
    .sort((a, b) => a.machineId.localeCompare(b.machineId))
}

// ---- helpers ----------------------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}
function redirect(res: http.ServerResponse, location: string, setCookie?: string): void {
  res.writeHead(302, { Location: location, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) })
  res.end()
}

function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > limit) { req.destroy(); resolve('') } })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

function headerValue(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name]
  return typeof v === 'string' && v ? v : null
}

// the login POST accepts the designed page's form encoding or JSON (the future admin UI)
function passwordOf(req: http.IncomingMessage, body: string): string {
  try {
    return req.headers['content-type']?.includes('application/json')
      ? String(JSON.parse(body).password ?? '')
      : new URLSearchParams(body).get('password') ?? ''
  } catch { return '' }
}

// the gateway's own cookies never cross into a backend — a backend knows nothing about visitors, and a
// leaked gateway token in some backend log would be a credential spill. Everything else passes through.
function stripGatewayCookies(header: string | undefined): string {
  return (header ?? '').split(';').map((s) => s.trim())
    .filter((p) => p && !/^spex_(admin|proj|auth)_/i.test(p.slice(0, Math.max(p.indexOf('='), 0))))
    .join('; ')
}

function cookieAttrs(secure: boolean): string {
  return `; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`
}

// ---- the hub ----------------------------------------------------------------------------------------

export function startHubGateway(opts: HubOpts): http.Server {
  const secure = !!opts.tls
  const port = opts.port
  const entry: Entry = opts.entry ?? 'console'
  const ext = opts.extensions ?? {}
  const attrs = cookieAttrs(secure)
  const clearCookie = (name: string) => `${name}=; HttpOnly; Path=/; Max-Age=0`

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // the store is re-read per request: a password set/clear (this process or another) is live at once,
    // and there is no in-memory session state to invalidate.
    const store = loadAuthStore()
    const rawUrl = req.url || '/'
    const q = rawUrl.indexOf('?')
    const path = q >= 0 ? rawUrl.slice(0, q) : rawUrl
    const query = q >= 0 ? rawUrl.slice(q) : ''
    const remote = req.socket.remoteAddress
    const cookies = req.headers.cookie
    const peerToken = entry === 'peer' ? headerValue(req, PEER_CREDENTIAL_HEADER) : null
    const adminz = () => authorize(store, { kind: 'admin' }, cookies, remote, port, entry, peerToken)
    // a peer proves itself with its issued credential and nothing else; answering an unauthorized machine
    // with a login page (or accepting a password from it) would turn this door into a password oracle.
    const needsCredential = (res: http.ServerResponse) => sendJson(res, 401, { error: 'peer credential required', header: PEER_CREDENTIAL_HEADER })
    const denied = (res: http.ServerResponse, login: string) => entry === 'peer' ? needsCredential(res) : redirect(res, login)

    // ---- admin surface ----
    if (path === '/') return redirect(res, '/projects')
    if (entry === 'peer' && (path === '/login' || path === '/logout')) {
      return sendJson(res, 404, { error: 'the peer ingress carries no visitor login' })
    }
    if (path === '/login') {
      if (!store.admin) return req.method === 'POST'
        ? sendJson(res, 403, { error: 'no admin password is configured — /projects is manageable from loopback only' })
        : redirect(res, '/projects')
      if (req.method === 'POST') {
        const pw = passwordOf(req, await readBody(req))
        if (verifyPassword(store.admin, pw)) return redirect(res, '/projects', `${adminCookieName(port)}=${mintToken(store, { s: 'admin' })}${attrs}`)
        return sendHtml(res, 401, loginPage(true))
      }
      return sendHtml(res, 200, loginPage(false))
    }
    if (path === '/logout') return redirect(res, '/login', clearCookie(adminCookieName(port)))

    if (path === '/projects' || path.startsWith('/projects/')) {
      // browser navigation (the `/` redirect lands here with Accept: text/html) wants the Projects UI,
      // not the catalog envelope. With a host shell mounted, an explicit text/html GET is served the SPA
      // shell — code, not data, same unauthorized-by-design posture as the fallback seam: every data call
      // the shell makes re-enters the JSON route below with its auth gate intact. API fetches
      // (application/json, */*, no Accept) keep the JSON catalog unchanged, as does the bare hub.
      if (path === '/projects' && req.method === 'GET' && ext.fallback && (req.headers.accept ?? '').includes('text/html')) {
        return ext.fallback(req, res, path)
      }
      const d = adminz()
      if (!d.ok) {
        if (d.reason === 'peer-credential') return needsCredential(res)
        return d.reason === 'locked'
          ? sendJson(res, 403, { error: 'admin surface is locked: no admin password is configured and this is not a loopback connection' })
          : sendJson(res, 401, { error: 'authentication required', login: '/login' })
      }
      if (path === '/projects' && req.method === 'GET') {
        const gateway = readGatewayIdentity()
        return sendJson(res, 200, {
          adminGated: !!store.admin,
          gateway: { ...gateway.identity, revision: gateway.revision },
          projects: await (ext.listProjects ? ext.listProjects(store) : listHubProjects(store)),
        })
      }
      if (path === '/projects/admin-password') {
        if (req.method === 'PUT') {
          const pw = passwordOf(req, await readBody(req))
          if (!pw) return sendJson(res, 400, { error: 'body must be JSON {"password": "<non-empty>"}' })
          const next = setAdminPassword(pw)
          // the setter stays authenticated: implicit-loopback access ends the moment the password exists,
          // so hand them a session minted under the new verifier in the same response.
          res.setHeader('Set-Cookie', `${adminCookieName(port)}=${mintToken(next, { s: 'admin' })}${attrs}`)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          clearAdminPassword()
          res.setHeader('Set-Cookie', clearCookie(adminCookieName(port)))
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 405, { error: 'PUT or DELETE' })
      }
      const m = path.match(/^\/projects\/([^/]+)\/password$/)
      if (m) {
        const id = decodeURIComponent(m[1])
        if (!validProjectId(id)) return sendJson(res, 404, { error: 'unknown project' })
        if (req.method === 'PUT') {
          if (!upstreamOf(id)) return sendJson(res, 404, { error: 'unknown project' })
          const pw = passwordOf(req, await readBody(req))
          if (!pw) return sendJson(res, 400, { error: 'body must be JSON {"password": "<non-empty>"}' })
          setProjectPassword(id, pw)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') { // clearing works even for a retired registry entry — the cleanup path
          clearProjectPassword(id)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 405, { error: 'PUT or DELETE' })
      }
      // host-level admin routes ([[host-gateway]]: /projects/stream, registration, project operations)
      // ride the SAME admin gate — the extension only ever sees an authorized request.
      if (ext.adminRoute && await ext.adminRoute(req, res, path)) return
      return sendJson(res, 404, { error: 'not found' })
    }

    // Host facts are an admin-scoped extension just like the project catalog, but live at a stable
    // top-level path so browsers, shells, and CLI readers share one identity-bearing endpoint.
    if ((path === '/host' || path.startsWith('/host/')) && ext.hostRoute) {
      const d = adminz()
      if (!d.ok) return d.reason === 'locked'
        ? sendJson(res, 403, { error: 'admin surface is locked: no admin password is configured and this is not a loopback connection' })
        : sendJson(res, 401, { error: 'authentication required', login: '/login' })
      if (await ext.hostRoute(req, res, path)) return
      return sendJson(res, 404, { error: 'not found' })
    }

    // ---- machine surface ----
    // Neither route exists on the peer ingress. A machine that could ask this door for /machines would be
    // reading OUR fleet, and a machine that could reach /m/* through it would be spending OUR credential on a
    // third machine — a confused deputy one hop deeper than the trust this door was built to contain.
    if (path === '/machines' || path === '/m' || path.startsWith('/m/')) {
      if (entry === 'peer') return sendJson(res, 404, { error: 'not found' })
      const d = adminz()
      if (!d.ok) return d.reason === 'locked'
        ? sendJson(res, 403, { error: 'admin surface is locked: no admin password is configured and this is not a loopback connection' })
        : sendJson(res, 401, { error: 'authentication required', login: '/login' })
      // Reaching another machine is an ADMIN act here, because the credential this hop spends is
      // admin-equivalent THERE. A project-scoped visitor holds one project on one machine and gains nothing
      // across the link; that is [[machine-routing]]'s "a visitor's scope on one machine grants nothing on
      // another", read from this side.
      if (path === '/machines') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET' })
        return sendJson(res, 200, { machineId: readPeerMachineId(), machines: listMachineRows() })
      }
      const mm = path.match(/^\/m\/([^/]+)(\/.*)?$/)
      if (!mm) return sendJson(res, 404, { error: 'unknown machine' })
      const machineId = decodeURIComponent(mm[1])
      if (!validProjectId(machineId)) return sendJson(res, 404, { error: 'unknown machine' })
      const peer = findMachine(machineId)
      if (!peer) return sendJson(res, 404, { error: 'unknown machine', machineId })
      const leg = legOf(peer)
      // A peer whose gateway is down is not a failed peer — its agent channel is unaffected — so this says
      // "no gateway there" and never pretends the machine is gone.
      if (!leg) return sendJson(res, 503, { error: 'that machine publishes no reachable gateway', machineId, state: peer.state })
      const base = `/m/${encodeURIComponent(machineId)}`
      const sub = mm[2] || '/'
      if (!mm[2]) return redirect(res, `${base}/${query}`)
      const headers: http.OutgoingHttpHeaders = { ...req.headers, [PEER_CREDENTIAL_HEADER]: leg.credential }
      const kept = stripGatewayCookies(req.headers.cookie)
      if (kept) headers.cookie = kept; else delete headers.cookie
      return proxyHttp(req, res, leg.port, sub + query, headers, `machine ${machineId} is not reachable`, '127.0.0.1',
        (upstream) => reanchorHeaders(upstream, base))
    }

    // ---- project surface ----
    const pm = path.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (pm) {
      const id = decodeURIComponent(pm[1])
      if (!validProjectId(id)) return sendJson(res, 404, { error: 'unknown project' })
      const up = upstreamOf(id)
      if (!up) return sendJson(res, 404, { error: 'unknown project' })
      const sub = pm[2] || '/'
      const base = `/p/${encodeURIComponent(id)}`
      const gated = !!store.projects[id]
      if (!pm[2]) return redirect(res, `${base}/${query}`)
      if (sub === '/login') {
        if (!gated) return redirect(res, `${base}/`)
        if (req.method === 'POST') {
          const pw = passwordOf(req, await readBody(req))
          if (verifyPassword(store.projects[id], pw)) {
            return redirect(res, `${base}/`, `${projectCookieName(port, id)}=${mintToken(store, { s: 'project', p: id })}${attrs}`)
          }
          return sendHtml(res, 401, loginPage(true, { action: `${base}/login`, heading: 'Project access', sub: `Enter the password for this project.` }))
        }
        return sendHtml(res, 200, loginPage(false, { action: `${base}/login`, heading: 'Project access', sub: `Enter the password for this project.` }))
      }
      if (sub === '/logout') return redirect(res, `${base}/login`, clearCookie(projectCookieName(port, id)))
      // browser navigation into the scoped page (`/p/<id>/`, any non-api/non-web sub) is content-negotiated
      // exactly like GET /projects, and — like the fallback it rides — PRE-authorization: the shell is
      // code, not data ([[projects-hub]]'s one credential card renders in-app off the scoped api's 401,
      // and a direct guest must reach that card, not a dead-end redirect). With a host fallback mounted,
      // Scoped GET dispatch matrix (sub shape, Accept, destination):
      //   /                 | text/html | dashboard shell
      //   /assets/x.js      | */*       | dashboard asset fallback
      //   /health           | */*       | project backend
      //   /api/graph        | text/html | project backend
      //   /web/<s>/<k>/     | text/html | posted preview
      //   /login            | text/html | hub login/redirect
      // Browser navigation and relative dashboard assets are static shell bytes, served from the same
      // fallback under the project prefix. API/SSE/health fetches, extensionless backend routes, posted-web
      // frames, and WS upgrades keep the auth gate and proxy to their backend untouched.
      if (req.method === 'GET' && ext.fallback) {
        if (!sub.startsWith('/api') && !sub.startsWith('/web/') && (req.headers.accept ?? '').includes('text/html')) {
          return ext.fallback(req, res, '/')
        }
        if (sub.startsWith('/assets/')) return ext.fallback(req, res, sub)
      }
      const d = authorize(store, { kind: 'project', projectId: id }, cookies, remote, port, entry, peerToken)
      if (!d.ok) {
        if (entry === 'console' && sub.startsWith('/api')) return sendJson(res, 401, { error: 'authentication required', login: `${base}/login` })
        return denied(res, `${base}/login`)
      }
      if (proxySessionWeb(req, res, sub + query, up.root)) return
      return proxyTo(req, res, up.port, sub + query)
    }

    // outside /projects and /p/: the dashboard shell + assets when a host extension serves them, 404 bare.
    if (ext.fallback) return ext.fallback(req, res, path)
    return sendJson(res, 404, { error: 'not found' })
  }

  // a handler throw answers 500 and never becomes an unhandled rejection — the hub owns a public port
  // and must keep serving (same posture as the supervisor's process guards).
  const safe = (req: http.IncomingMessage, res: http.ServerResponse) =>
    void handler(req, res).catch((e) => {
      console.error(`[hub] request failed: ${(e as Error).message}`)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"error":"internal error"}')
    })
  const server = secure
    ? https.createServer({ cert: opts.tls!.cert, key: opts.tls!.key }, safe)
    : http.createServer(safe)
  installConnectionReaper(server)

  // the terminal WebSocket rides an HTTP upgrade on a /p/:id path: same authorization, then a raw byte
  // pipe to that project's backend with the prefix stripped and the gateway cookies filtered out.
  server.on('upgrade', (req, socket, head) => {
    const store = loadAuthStore()
    const rawUrl = req.url || '/'
    const q = rawUrl.indexOf('?')
    const path = q >= 0 ? rawUrl.slice(0, q) : rawUrl
    const query = q >= 0 ? rawUrl.slice(q) : ''
    const mm = path.match(/^\/m\/([^/]+)(\/.*)?$/)
    if (mm) {
      // the terminal socket is the whole point of forwarding a GATEWAY rather than a route allowlist: one leg
      // yields the live product on that machine. Same admin gate as the machine hop's HTTP half, same
      // credential, and no machine route at all on the peer ingress.
      if (entry === 'peer') return socket.destroy()
      const machineId = decodeURIComponent(mm[1])
      if (!validProjectId(machineId)) return socket.destroy()
      const d = authorize(store, { kind: 'admin' }, req.headers.cookie, req.socket.remoteAddress, port, entry, null)
      if (!d.ok) return socket.destroy()
      const peer = findMachine(machineId)
      const leg = peer && legOf(peer)
      if (!leg) return socket.destroy()
      return pipeUpgrade(req, socket, head, leg.port, (mm[2] || '/') + query, { [PEER_CREDENTIAL_HEADER]: leg.credential })
    }
    const pm = path.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (!pm) return socket.destroy()
    const id = decodeURIComponent(pm[1])
    if (!validProjectId(id)) return socket.destroy()
    const up = upstreamOf(id)
    if (!up) return socket.destroy()
    const d = authorize(store, { kind: 'project', projectId: id }, req.headers.cookie, req.socket.remoteAddress, port,
      entry, entry === 'peer' ? headerValue(req, PEER_CREDENTIAL_HEADER) : null)
    if (!d.ok) return socket.destroy()
    const sub = (pm[2] || '/') + query
    if (proxySessionWebUpgrade(req, socket, head, sub, up.root)) return
    pipeUpgrade(req, socket, head, up.port, sub)
  })

  const scheme = secure ? 'https' : 'http'
  listenOrExit(server, port, {
    host: opts.host,
    label: opts.label ?? 'hub gateway',
    cleanup: opts.onBindFail,
    onListen: opts.onListen,
    ready: (actualPort) => entry === 'peer'
      ? `[hub] peer ingress on ${scheme}://127.0.0.1:${actualPort} — linked machines only, credential required`
      : `[hub] multi-project gateway on ${scheme}://${opts.host}:${actualPort} — /projects + /p/:projectId/*`,
  })
  return server
}

// What a machine hop must fix in the far gateway's own words about itself.
//   Location: the far side names absolute paths (`/projects`, `/p/<id>/`) because it believes it is the root.
//     Passed through, the browser resolves them on THIS origin and silently changes machine — the exact bug a
//     machine segment exists to prevent — so a leading-slash Location is re-anchored under the segment. A
//     protocol-relative `//host` value becomes a path here rather than an off-origin jump, which is the safer
//     of the two readings.
//   Set-Cookie: dropped whole. This hop is authorized by the machine credential, not by a visitor session over
//     there, so the far side's cookies have nothing to do here; and since a cookie name carries only the port
//     ([[gateway-auth]]), two gateways on the same port number would otherwise clobber each other's session in
//     one browser.
function reanchorHeaders(upstream: http.IncomingHttpHeaders, base: string): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...upstream }
  delete out['set-cookie']
  if (typeof out.location === 'string' && out.location.startsWith('/')) out.location = base + out.location
  return out
}

// replay an upgrade's headers with the Cookie header rewritten to exclude the gateway's own cookies, and any
// `extra` header stamped by this hop replacing whatever the client sent under that name — a client-supplied
// duplicate would otherwise arrive upstream as a comma-joined pair and read as neither value.
function filteredRawHeaders(req: http.IncomingMessage, extra: Record<string, string> = {}): string {
  const stamped = new Set(Object.keys(extra).map((k) => k.toLowerCase()))
  let s = ''
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    if (name.toLowerCase() === 'cookie') {
      const kept = stripGatewayCookies(req.rawHeaders[i + 1])
      if (kept) s += `Cookie: ${kept}\r\n`
      continue
    }
    if (stamped.has(name.toLowerCase())) continue
    s += `${name}: ${req.rawHeaders[i + 1]}\r\n`
  }
  for (const [name, value] of Object.entries(extra)) s += `${name}: ${value}\r\n`
  return s + '\r\n'
}

// ONE raw upgrade pipe for every hop that has one — a project backend on this machine, or a peered machine's
// gateway. Both are a loopback port and a rewritten request line; nothing else about them differs.
function pipeUpgrade(req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer, upstreamPort: number, sub: string, extra: Record<string, string> = {}): void {
  const upstream = net.connect(upstreamPort, '127.0.0.1', () => {
    upstream.write(`${req.method} ${sub} HTTP/1.1\r\n` + filteredRawHeaders(req, extra))
    if (head && head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  const bail = () => { socket.destroy(); upstream.destroy() }
  socket.on('error', bail); upstream.on('error', bail)
  // pair the halves fully (the supervisor's rule): an http server's sockets are allowHalfOpen, so a bare
  // client FIN ('end') would otherwise leave a zombie socket the server can never close — an upgraded
  // stream never half-closes legitimately, so either half's FIN or close tears down both.
  socket.on('end', bail); upstream.on('end', bail)
  socket.once('close', () => upstream.destroy())
  upstream.once('close', () => socket.destroy())
}

// reverse-proxy one authorized request to a project's loopback backend, prefix already stripped.
function proxyTo(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number, path: string): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers }
  const kept = stripGatewayCookies(req.headers.cookie)
  if (kept) headers.cookie = kept; else delete headers.cookie
  proxyHttp(req, res, upstreamPort, path, headers)
}
