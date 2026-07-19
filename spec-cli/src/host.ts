// @@@ host gateway ([[host-gateway]]) - the host-level face of every SpexCode project this user runs.
// Each `spex serve` stays scoped to ONE repo, loopback-only and auth-unaware; what it contributes to the
// host is a single instance-validated endpoint record in the per-user global store. THIS module is the
// other half: the durable known-project catalog, the reconciler that turns records into a validated live
// project list, portable-config editor, and host operations (register/init/doctor/start) — mounted as [[gateway-hub]]'s
// extension by `spex dashboard` (startHostDashboard below), so routing, /p/:projectId proxying, and
// authorization ([[gateway-auth]]) stay the hub's single seam and are never duplicated here. Backends
// never depend on the gateway: they publish records and serve loopback whether or not a gateway is
// running, and direct CLI discovery (sessions.ts's ladder) keeps reading the same records.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, openSync, closeSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spexcodeHome, encodeProject } from './layout.js'
import { git } from './git.js'
import { serveStatic, resolveDistDir, ensureDashboardBuilt } from './gateway.js'
import { startHubGateway, type HubExtensions } from './gateway-hub.js'
import { tsxBin } from './tsx-bin.js'
import { DEFAULT_PROJECT_ICON, requireIdentityChoice } from './identity-presets.js'
import {
  resolveProjectIdentity, writeGatewayIcon, type ResolvedIdentity,
} from './project-identity.js'

const here = dirname(fileURLToPath(import.meta.url))

// ── the endpoint record ──────────────────────────────────────────────────────────────────────────────
// One record per project, written by that project's `spex serve` after its public bind succeeds and
// removed (only by its own writer) on a clean stop. The shape carries the serve's IDENTITY — url, pid,
// instanceId, root — so a reader can validate "the backend at this url is the serve that wrote this
// record, serving this root" instead of trusting a URL that a recycled port may have re-occupied.
export type EndpointRecord = {
  version: 2; url: string; pid: number; instanceId: string; root: string
  identity: ResolvedIdentity; startedAt: string
}

export const endpointRecordPath = (root: string): string =>
  join(spexcodeHome(), 'projects', encodeProject(root), 'backend.json')

// atomic publish: tmp + rename, so a reader never sees a torn record (the old write-in-place could be
// caught mid-write by the reconciler or a bare `spex`'s discovery probe).
export function publishEndpoint(rec: EndpointRecord): void {
  const file = endpointRecordPath(rec.root)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.backend.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n')
  renameSync(tmp, file)
}

// remove the record ONLY if it is ours (matched by instanceId): a newer serve that already overwrote it,
// or another project's record, is never deleted by a retiring process.
export function dropOwnEndpoint(instanceId: string, root: string): void {
  const file = endpointRecordPath(root)
  try { if (JSON.parse(readFileSync(file, 'utf8'))?.instanceId === instanceId) rmSync(file) } catch { /* not ours / already gone */ }
}

// a record is HOSTABLE only in the full identity shape; legacy {url,pid} records (pre-instance-identity)
// are ignored by the host — the direct CLI ladder still reads their url, and they are rewritten in the new
// shape the next time that serve restarts.
export function readEndpointRecord(file: string): EndpointRecord | null {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'))
    if (r?.version === 2 && typeof r.url === 'string' && typeof r.instanceId === 'string' && typeof r.root === 'string' &&
      typeof r.identity?.title === 'string' && typeof r.identity?.icon === 'string') return r as EndpointRecord
    return null
  } catch { return null }
}

// ── the durable known-project catalog ────────────────────────────────────────────────────────────────
// ~/.spexcode/projects.json — the host's memory of which projects exist, so /projects can list a project
// whose backend is OFFLINE (records vanish with their serve; the catalog does not). Populated two ways:
// explicitly (the add op) and by auto-adoption of any validated live record, so every project ever served
// under this user shows up without a registration ceremony.
export type CatalogEntry = { root: string; addedAt: string }
export const catalogPath = (): string => join(spexcodeHome(), 'projects.json')

let catalogWarned = false
export function readCatalog(): CatalogEntry[] {
  let raw: string
  try { raw = readFileSync(catalogPath(), 'utf8') } catch { return [] }
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed?.projects) ? parsed.projects : []
    return list.filter((e: any): e is CatalogEntry => e && typeof e.root === 'string')
  } catch (e) {
    // reads degrade loud-but-alive (the reconciler must keep serving live records); WRITES refuse below,
    // so a malformed catalog is never silently clobbered.
    if (!catalogWarned) { catalogWarned = true; console.error(`[host] malformed ${catalogPath()} (${(e as Error).message}) — known-project catalog ignored until fixed`) }
    return []
  }
}

function writeCatalog(entries: CatalogEntry[]): void {
  if (existsSync(catalogPath())) {
    try { JSON.parse(readFileSync(catalogPath(), 'utf8')) }
    catch { throw new Error(`refusing to overwrite malformed ${catalogPath()} — fix or remove it first`) }
  }
  mkdirSync(dirname(catalogPath()), { recursive: true })
  const tmp = join(dirname(catalogPath()), `.projects.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify({ projects: entries }, null, 2) + '\n')
  renameSync(tmp, catalogPath())
}

// register an existing repo: normalize any path inside the repo to its MAIN checkout (the identity every
// record and store key uses), require a git repo (matching `spex init`'s own precondition — SpexCode is
// git-backed), dedupe, persist. Returns the normalized root.
export function addKnownProject(dir: string): string {
  let root: string
  try { root = dirname(git(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()) }
  catch { throw new Error(`${dir} is not a git repository — SpexCode projects are git-backed (run \`git init\` there first)`) }
  catalogAdd(root)
  return root
}
function catalogAdd(root: string): void {
  const entries = readCatalog()
  if (entries.some((e) => e.root === root)) return
  writeCatalog([...entries, { root, addedAt: new Date().toISOString() }])
}

// ── the reconciler ───────────────────────────────────────────────────────────────────────────────────
// Turn the global store's endpoint records + the catalog into ONE validated project list. A record counts
// as ONLINE only when (a) it sits in the store slot its own root encodes to, and (b) the live backend at
// its url answers /api/instance with the SAME instanceId and root — anything else (dead process, recycled
// port, copied record, another project's serve) is just an offline project, never a proxy target.
export type ProjectEntry = {
  projectId: string; root: string; identity: ResolvedIdentity; configRevision: string
  online: boolean; url: string | null; pid?: number; startedAt?: string
}

type LiveInstance = { instanceId?: string; root?: string; identity?: ResolvedIdentity }
async function fetchInstance(url: string): Promise<LiveInstance | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const r = await fetch(`${url}/api/instance`, { signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json() as LiveInstance
  } catch { return null }
  finally { clearTimeout(t) }
}

export async function reconcileProjects(): Promise<ProjectEntry[]> {
  const projectsDir = join(spexcodeHome(), 'projects')
  let dirs: string[] = []
  try { dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }

  const live = new Map<string, { rec: EndpointRecord; identity: ResolvedIdentity }>()
  const claimed = new Set<string>()                  // roots with a slot-matched record, validated or not
  await Promise.all(dirs.map(async (d) => {
    const rec = readEndpointRecord(join(projectsDir, d, 'backend.json'))
    if (!rec) return
    if (encodeProject(rec.root) !== d) return
    claimed.add(rec.root)                       // a dead/mismatched record still NAMES a project — listed offline
    const inst = await fetchInstance(rec.url)
    if (inst && inst.instanceId === rec.instanceId && inst.root === rec.root &&
      typeof inst.identity?.title === 'string' && typeof inst.identity?.icon === 'string') {
      live.set(rec.root, { rec, identity: inst.identity })
    }
  }))

  // auto-adopt: a VALIDATED live root becomes durable catalog knowledge, so it stays listed after its
  // serve stops. Unvalidated claims are listed this pass but never written durable — a stale or wrong
  // record must not pollute the catalog. Best-effort — a refused catalog write (malformed file) must not
  // hide live backends.
  for (const root of live.keys()) {
    try { catalogAdd(root) } catch (e) { if (!catalogWarned) { catalogWarned = true; console.error(`[host] ${(e as Error).message}`) } }
  }

  const byId = new Map<string, ProjectEntry>()
  const push = (root: string) => {
    const projectId = encodeProject(root)
    if (byId.has(projectId)) return   // encodeProject is lossy; first root wins a (pathological) collision
    const active = live.get(root) ?? null
    const source = readProjectConfig(root)
    let identity: ResolvedIdentity
    try { identity = active?.identity ?? resolveProjectIdentity(root, root) }
    catch (e) {
      console.error(`[host] cannot resolve identity for ${root}: ${(e as Error).message}`)
      identity = { title: basename(root), icon: DEFAULT_PROJECT_ICON }
    }
    byId.set(projectId, {
      projectId, root, identity, configRevision: source.revision,
      online: !!active, url: active?.rec.url ?? null,
      ...(active ? { pid: active.rec.pid, startedAt: active.rec.startedAt } : {}),
    })
  }
  for (const e of readCatalog()) push(e.root)
  for (const root of claimed) push(root)
  return [...byId.values()].sort((a, b) => a.identity.title.localeCompare(b.identity.title) || a.root.localeCompare(b.root))
}

// single-flight + last-snapshot: every reader (GET, the stream loop, the per-request proxy resolution)
// shares one in-flight reconcile instead of stampeding probes.
let snapshot: ProjectEntry[] = []
let inflight: Promise<ProjectEntry[]> | null = null
export function reconcileNow(): Promise<ProjectEntry[]> {
  return (inflight ??= reconcileProjects()
    .then((list) => { snapshot = list; return list })
    .finally(() => { inflight = null }))
}

// ── host operations (spawned `spex`, never forked logic) ─────────────────────────────────────────────
// init / doctor / serve run the EXISTING CLI implementations as child processes with cwd = the project
// root: the same git/harness/additive guarantees `spex init` gives at a terminal, the same doctor report,
// the same supervisor `spex serve` boots — no second implementation of any domain semantics. The spawned
// env is scrubbed of routing state (SPEXCODE_API_URL/PORT/session/instance ids) so a child never inherits
// the gateway's — or another project's — backend routing.
const cliEntry = join(here, 'cli.ts')
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.SPEXCODE_API_URL; delete env.PORT
  delete env.SPEXCODE_SESSION_ID; delete env.SPEXCODE_INSTANCE_ID
  return env
}

export function runSpex(root: string, args: string[], timeoutMs = 120_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxBin(join(here, '..')), cliEntry, ...args], { cwd: root, env: scrubbedEnv() })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, timeoutMs)
    child.on('close', (code) => { clearTimeout(t); resolve({ code, output }) })
    child.on('error', (e) => { clearTimeout(t); resolve({ code: null, output: `${output}\nspawn failed: ${e.message}` }) })
  })
}

// The dashboard edits the committed, portable source file verbatim. The host fixes the filename (there
// is no browser-supplied path), works for offline projects, and uses a content revision so a save cannot
// clobber a concurrent agent/user edit. spexcode.local.json stays outside this surface by contract.
type ProjectConfigSource = { content: string; revision: string }
let configWriteSeq = 0
const configRevision = (raw: string | null): string => createHash('sha256').update(raw === null ? 'missing' : `present\0${raw}`).digest('hex')

function readProjectConfig(root: string): ProjectConfigSource {
  try {
    const content = readFileSync(join(root, 'spexcode.json'), 'utf8')
    return { content, revision: configRevision(content) }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { content: '{}\n', revision: configRevision(null) }
    throw e
  }
}

function writeProjectConfig(root: string, content: string, revision: string): ProjectConfigSource {
  const current = readProjectConfig(root)
  if (revision !== current.revision) {
    const e = new Error('spexcode.json changed on disk — reload before saving') as Error & { status?: number }
    e.status = 409
    throw e
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) }
  catch (e) {
    const err = new Error(`spexcode.json is not valid JSON: ${(e as Error).message}`) as Error & { status?: number }
    err.status = 400
    throw err
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const e = new Error('spexcode.json must contain one top-level JSON object') as Error & { status?: number }
    e.status = 400
    throw e
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`
  const file = join(root, 'spexcode.json')
  const tmp = join(root, `.spexcode.json.${process.pid}.${++configWriteSeq}.tmp`)
  try {
    writeFileSync(tmp, normalized)
    renameSync(tmp, file)
  } finally {
    try { rmSync(tmp) } catch { /* rename consumed it / write never created it */ }
  }
  return { content: normalized, revision: configRevision(normalized) }
}

function writeProjectIcon(root: string, icon: unknown, revision: string): ProjectConfigSource & { identity: ResolvedIdentity } {
  const canonical = requireIdentityChoice(icon)
  const current = readProjectConfig(root)
  let config: Record<string, any>
  try { config = JSON.parse(current.content) }
  catch (e) {
    const error = new Error(`spexcode.json is not valid JSON: ${(e as Error).message}`) as Error & { status?: number }
    error.status = 400
    throw error
  }
  const dashboard = config.dashboard === undefined
    ? {}
    : config.dashboard && typeof config.dashboard === 'object' && !Array.isArray(config.dashboard)
      ? config.dashboard
      : null
  if (!dashboard) {
    const error = new Error('spexcode.json dashboard must be an object before its icon can be changed') as Error & { status?: number }
    error.status = 400
    throw error
  }
  const saved = writeProjectConfig(root, `${JSON.stringify({ ...config, dashboard: { ...dashboard, icon: canonical } }, null, 2)}\n`, revision)
  return { ...saved, identity: resolveProjectIdentity(root, root) }
}

function freeTcpPort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) })
  })
}

// start an OFFLINE project's backend: spawn a detached `spex serve --port <free>` whose lifetime is
// independent of the gateway (it owns its record exactly like a hand-run serve), log to the project's
// runtime tier, and wait for its instance-validated record to reconcile online.
export async function startBackend(root: string, waitMs = 45_000): Promise<ProjectEntry> {
  const port = await freeTcpPort()
  const logDir = join(spexcodeHome(), 'projects', encodeProject(root))
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'serve.log')
  const log = openSync(logFile, 'a')
  const child = spawn(process.execPath, [tsxBin(join(here, '..')), cliEntry, 'serve', '--port', String(port)],
    { cwd: root, env: scrubbedEnv(), detached: true, stdio: ['ignore', log, log] })
  child.unref()
  closeSync(log)   // the child holds its own copy; keep no fd open in the gateway
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    const entry = (await reconcileNow()).find((p) => p.root === root && p.online)
    if (entry) return entry
  }
  throw new Error(`backend for ${root} did not come online within ${Math.round(waitMs / 1000)}s — see ${logFile}`)
}


// ── the operator verb: `spex dashboard` = the hub + the host extensions ─────────────────────────────
// The hub ([[gateway-hub]]) is the ONE routing + authorization server; this layer never runs a second
// gateway or a second auth check beside it. What the host adds rides the hub's extension seam:
//   listProjects — GET /projects rows come from the instance-validated reconciler + the durable catalog
//                  (online/offline/root), each carrying the hub's gating state.
//   adminRoute   — /projects/stream (SSE), POST /projects (register a repo), raw spexcode.json
//                  GET|PUT /projects/:id/config, and POST /projects/:id/(init|doctor|serve) — all
//                  behind the hub's admin scope
//                  ([[gateway-auth]]: implicit from loopback until an admin password exists).
//   fallback     — the dashboard SPA shell + assets for paths the hub doesn't own.
// /p/:projectId/* routing (HTTP, SSE, WS; prefix strip; cookie strip) belongs entirely to the hub.

// tls is the HUB's transport option passed through unchanged ([[gateway-hub]] terminates HTTPS itself),
// so an operator deployment runs the ONE host gateway directly over TLS — no second proxy in front.
// Absent tls = the default plain-HTTP loopback `spex dashboard` serves.
export type HostDashboardOpts = { port: number; host?: string; distDir?: string; tls?: { cert: string; key: string } | null }
export type HostDashboard = { server: http.Server; close: () => Promise<void> }

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy() })
    req.on('end', () => resolve(body))
  })
}

export function startHostDashboard(opts: HostDashboardOpts): HostDashboard {
  const distDir = opts.distDir ?? resolveDistDir()
  if (!opts.distDir) ensureDashboardBuilt(join(here, '..', '..'), distDir)

  const sseClients = new Set<http.ServerResponse>()
  let lastBroadcast = ''
  // reconcile → push the fresh list to every /projects/stream subscriber when it changed.
  async function tick(): Promise<ProjectEntry[]> {
    const list = await reconcileNow()
    const j = JSON.stringify(list)
    if (j !== lastBroadcast) { lastBroadcast = j; for (const c of sseClients) c.write(`data: ${j}\n\n`) }
    return list
  }

  const extensions: HubExtensions = {
    // the hub's GET /projects rows, host-enriched: every cataloged/claimed project (not only live
    // records), instance-validated online state, and the hub's own gating flag per row. `id` mirrors
    // projectId — the hub's documented row key, kept so both shapes read the same list.
    listProjects: async (store) => (await tick()).map((p) => ({ id: p.projectId, ...p, gated: !!store.projects[p.projectId] })),

    adminRoute: async (req, res, path) => {
      if (path === '/projects/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(await tick())}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return true
      }
      if (path === '/projects' && req.method === 'POST') {
        let root = ''
        try { root = String(JSON.parse(await readBody(req) || '{}')?.root ?? '').trim() } catch { /* malformed body */ }
        if (!root) { json(res, 400, { error: 'body must be {"root": "/abs/path/to/repo"}' }); return true }
        try {
          const normalized = addKnownProject(root)
          const entry = (await tick()).find((p) => p.root === normalized)
          json(res, 200, entry ?? {
            projectId: encodeProject(normalized), root: normalized,
            identity: resolveProjectIdentity(normalized, normalized), configRevision: readProjectConfig(normalized).revision,
            online: false, url: null,
          })
        } catch (e) { json(res, 400, { error: (e as Error).message }) }
        return true
      }
      if (path === '/projects/icon' && req.method === 'PUT') {
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' }); return true }
        if (typeof body?.icon !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, gateway: writeGatewayIcon(body.icon, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 400, { error: (e as Error).message }) }
        return true
      }
      const icon = path.match(/^\/projects\/([^/]+)\/icon$/)
      if (icon && req.method === 'PUT') {
        const projectId = decodeURIComponent(icon[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' }); return true }
        if (typeof body?.icon !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, ...writeProjectIcon(entry.root, body.icon, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 400, { error: (e as Error).message }) }
        return true
      }
      const config = path.match(/^\/projects\/([^/]+)\/config$/)
      if (config && (req.method === 'GET' || req.method === 'PUT')) {
        const projectId = decodeURIComponent(config[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        if (req.method === 'GET') {
          try { json(res, 200, readProjectConfig(entry.root)) }
          catch (e) { json(res, 500, { error: `cannot read spexcode.json: ${(e as Error).message}` }) }
          return true
        }
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"content":"...","revision":"..."}' }); return true }
        if (typeof body?.content !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"content":"...","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, ...writeProjectConfig(entry.root, body.content, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 500, { error: (e as Error).message }) }
        return true
      }
      const op = path.match(/^\/projects\/([^/]+)\/(init|doctor|serve)$/)
      if (op && req.method === 'POST') {
        const projectId = decodeURIComponent(op[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        if (op[2] === 'serve') {
          if (entry.online) { json(res, 409, { error: `backend already online at ${entry.url}`, project: entry }); return true }
          try { json(res, 200, { ok: true, project: await startBackend(entry.root) }) }
          catch (e) { json(res, 502, { error: (e as Error).message }) }
          return true
        }
        let body: any = {}
        try { body = JSON.parse(await readBody(req) || '{}') } catch { /* malformed body → defaults */ }
        const args = op[2] === 'init'
          ? ['init', ...(body?.harness ? ['--harness', String(body.harness)] : []), ...(body?.preset ? ['--preset', String(body.preset)] : [])]
          : ['doctor']
        const r = await runSpex(entry.root, args)
        json(res, 200, { ok: r.code === 0, code: r.code, output: r.output })
        return true
      }
      return false
    },

    fallback: (req, res, path) => serveStatic(req, res, distDir, path),
  }

  const server = startHubGateway({ port: opts.port, host: opts.host ?? '127.0.0.1', tls: opts.tls ?? null, extensions })

  // continuous reconciliation: the stream stays live without a client-side poll and the list the hub
  // serves stays fresh. Heartbeat comments keep intermediaries from timing the stream out. Both timers
  // unref'd — the SERVER holds the process open, not the loops.
  const loop = setInterval(() => void tick().catch((e) => console.error(`[host] reconcile failed: ${(e as Error).message}`)), 2500)
  loop.unref()
  const ping = setInterval(() => { for (const c of sseClients) c.write(': ping\n\n') }, 10_000)
  ping.unref()

  return {
    server,
    close: () => new Promise<void>((resolve) => {
      clearInterval(loop); clearInterval(ping)
      for (const c of sseClients) c.destroy()
      sseClients.clear()
      server.close(() => resolve())
      server.closeAllConnections?.()
    }),
  }
}
