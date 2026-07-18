// @@@ host gateway ([[host-gateway]]) - the host-level face of every SpexCode project this user runs.
// Each `spex serve` stays scoped to ONE repo, loopback-only and auth-unaware; what it contributes to the
// host is a single instance-validated endpoint record in the per-user global store. THIS module is the
// other half: the durable known-project catalog, the reconciler that turns records into a validated live
// project list, and the `spex dashboard` gateway that serves the built dashboard once for the whole host
// and proxies per-project traffic through explicit /p/:projectId/* routes — no mutable current-project
// state anywhere: every request names its project in the path and is routed off the latest reconciled
// snapshot. Backends never depend on the gateway: they publish records and serve loopback whether or not
// a gateway is running, and direct CLI discovery (sessions.ts's ladder) keeps reading the same records.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, openSync, closeSync, existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spexcodeHome, encodeProject } from './layout.js'
import { git } from './git.js'
import { listenOrExit } from './listen.js'
import { installConnectionReaper } from './reaper.js'
import { proxyHttp, serveStatic, rawHeaders, resolveDistDir, ensureDashboardBuilt } from './gateway.js'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))

// ── the endpoint record ──────────────────────────────────────────────────────────────────────────────
// One record per project, written by that project's `spex serve` after its public bind succeeds and
// removed (only by its own writer) on a clean stop. The shape carries the serve's IDENTITY — url, pid,
// instanceId, root — so a reader can validate "the backend at this url is the serve that wrote this
// record, serving this root" instead of trusting a URL that a recycled port may have re-occupied.
export type EndpointRecord = { url: string; pid: number; instanceId: string; root: string; startedAt: string }

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
    if (r && typeof r.url === 'string' && typeof r.instanceId === 'string' && typeof r.root === 'string') return r as EndpointRecord
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
  projectId: string; root: string; name: string
  online: boolean; url: string | null; pid?: number; startedAt?: string
}

async function fetchInstance(url: string): Promise<{ instanceId?: string; root?: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const r = await fetch(`${url}/api/instance`, { signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json() as { instanceId?: string; root?: string }
  } catch { return null }
  finally { clearTimeout(t) }
}

export async function reconcileProjects(): Promise<ProjectEntry[]> {
  const projectsDir = join(spexcodeHome(), 'projects')
  let dirs: string[] = []
  try { dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }

  const live = new Map<string, EndpointRecord>()     // root → validated record (proxyable)
  const claimed = new Set<string>()                  // roots with a slot-matched record, validated or not
  await Promise.all(dirs.map(async (d) => {
    const rec = readEndpointRecord(join(projectsDir, d, 'backend.json'))
    if (!rec) return
    if (encodeProject(rec.root) !== d) return   // a record in a slot its root doesn't own is not trusted
    claimed.add(rec.root)                       // a dead/mismatched record still NAMES a project — listed offline
    const inst = await fetchInstance(rec.url)
    if (inst && inst.instanceId === rec.instanceId && inst.root === rec.root) live.set(rec.root, rec)
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
    const rec = live.get(root) ?? null
    byId.set(projectId, {
      projectId, root, name: basename(root),
      online: !!rec, url: rec?.url ?? null,
      ...(rec ? { pid: rec.pid, startedAt: rec.startedAt } : {}),
    })
  }
  for (const e of readCatalog()) push(e.root)
  for (const root of claimed) push(root)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root))
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

// ── the gateway server ───────────────────────────────────────────────────────────────────────────────
export type HostGatewayOpts = { port: number; host?: string; distDir?: string }
export type HostGateway = { server: http.Server; close: () => Promise<void> }

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

// /p/:projectId/<rest> — the explicit per-project route. Returns null when the url is not project-scoped.
function parseProjectPath(url: string): { projectId: string; rest: string } | null {
  const m = url.match(/^\/p\/([^/?]+)([/?].*)?$/)
  if (!m) return null
  let rest = m[2] ?? '/'
  if (rest.startsWith('?')) rest = '/' + rest
  return { projectId: decodeURIComponent(m[1]), rest }
}
const upstreamPort = (url: string): number => Number(new URL(url).port || 80)

export function startHostGateway(opts: HostGatewayOpts): HostGateway {
  const distDir = opts.distDir ?? resolveDistDir()
  if (!opts.distDir) ensureDashboardBuilt(join(here, '..', '..'), distDir)
  const host = opts.host ?? '127.0.0.1'

  const sseClients = new Set<http.ServerResponse>()
  let lastBroadcast = ''
  // reconcile → push the fresh list to every /api/host/projects/stream subscriber when it changed.
  async function tick(): Promise<ProjectEntry[]> {
    const list = await reconcileNow()
    const j = JSON.stringify(list)
    if (j !== lastBroadcast) { lastBroadcast = j; for (const c of sseClients) c.write(`data: ${j}\n\n`) }
    return list
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const full = req.url || '/'
    const path = full.split('?')[0]

    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok') }

    // host surface: the live project list, its stream, and the /projects operations.
    if (path === '/api/host/projects' && req.method === 'GET') return json(res, 200, await tick())
    if (path === '/api/host/projects/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`data: ${JSON.stringify(await tick())}\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }
    if (path === '/api/host/projects' && req.method === 'POST') {
      let root = ''
      try { root = String(JSON.parse(await readBody(req) || '{}')?.root ?? '').trim() } catch { /* malformed body */ }
      if (!root) return json(res, 400, { error: 'body must be {"root": "/abs/path/to/repo"}' })
      try {
        const normalized = addKnownProject(root)
        const entry = (await tick()).find((p) => p.root === normalized)
        return json(res, 200, entry ?? { projectId: encodeProject(normalized), root: normalized, name: basename(normalized), online: false, url: null })
      } catch (e) { return json(res, 400, { error: (e as Error).message }) }
    }
    const op = path.match(/^\/api\/host\/projects\/([^/]+)\/(init|doctor|serve)$/)
    if (op && req.method === 'POST') {
      const projectId = decodeURIComponent(op[1])
      const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
      if (!entry) return json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /api/host/projects)` })
      if (op[2] === 'serve') {
        if (entry.online) return json(res, 409, { error: `backend already online at ${entry.url}`, project: entry })
        try { return json(res, 200, { ok: true, project: await startBackend(entry.root) }) }
        catch (e) { return json(res, 502, { error: (e as Error).message }) }
      }
      let body: any = {}
      try { body = JSON.parse(await readBody(req) || '{}') } catch { /* malformed body → defaults */ }
      const args = op[2] === 'init'
        ? ['init', ...(body?.harness ? ['--harness', String(body.harness)] : []), ...(body?.preset ? ['--preset', String(body.preset)] : [])]
        : ['doctor']
      const r = await runSpex(entry.root, args)
      return json(res, 200, { ok: r.code === 0, code: r.code, output: r.output })
    }

    // per-project traffic: /p/:projectId/api/* proxies to that project's validated backend (HTTP + SSE
    // ride the same streaming pipe); any other /p/ path serves the SPA shell, so a project-scoped URL
    // loads the dashboard. Routing is per-request off the latest snapshot — no current-project state.
    const pp = parseProjectPath(full)
    if (pp) {
      const restPath = pp.rest.split('?')[0]
      if (restPath === '/api' || restPath.startsWith('/api/')) {
        let entry = snapshot.find((p) => p.projectId === pp.projectId)
        if (!entry || !entry.online) entry = (await reconcileNow()).find((p) => p.projectId === pp.projectId)
        if (!entry) return json(res, 404, { error: `unknown project '${pp.projectId}'` })
        if (!entry.online || !entry.url) return json(res, 502, { error: `project '${pp.projectId}' has no live backend — start one (POST /api/host/projects/${encodeURIComponent(pp.projectId)}/serve or \`spex serve\` in ${entry.root})` })
        return proxyHttp(req, res, upstreamPort(entry.url), pp.rest)
      }
      return serveStatic(req, res, distDir, restPath)
    }

    return serveStatic(req, res, distDir, path)
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      console.error(`[host] ${req.method} ${req.url} failed: ${(e as Error).stack ?? e}`)
      if (!res.headersSent) json(res, 500, { error: (e as Error).message })
      else res.end()
    })
  })
  installConnectionReaper(server)

  // the terminal WebSocket, per project: gate nothing (auth is out of scope), resolve the target from the
  // reconciled snapshot, replay the buffered upgrade against the backend and raw-pipe both halves —
  // the same byte pipe the public gateway uses, with the /p/:projectId prefix stripped.
  server.on('upgrade', (req, socket, head) => {
    const pp = parseProjectPath(req.url || '')
    const entry = pp && snapshot.find((p) => p.projectId === pp.projectId)
    if (!pp || !entry || !entry.online || !entry.url) { socket.destroy(); return }
    const up = net.connect(upstreamPort(entry.url), '127.0.0.1', () => {
      up.write(`${req.method} ${pp.rest} HTTP/1.1\r\n` + rawHeaders(req))
      if (head && head.length) up.write(head)
      socket.pipe(up); up.pipe(socket)
    })
    const bail = () => { socket.destroy(); up.destroy() }
    socket.on('error', bail); up.on('error', bail)
    // an upgraded stream never half-closes legitimately, and an http server's sockets are allowHalfOpen —
    // a client FIN alone would strand a zombie socket the server can never close. So EITHER half's
    // FIN ('end') or close tears down BOTH (the supervisor's pairing rule, one layer up).
    socket.on('end', bail); up.on('end', bail)
    socket.once('close', () => up.destroy())
    up.once('close', () => socket.destroy())
  })

  // continuous reconciliation: the stream stays live without a client-side poll (the SSE broadcast in
  // tick()), and the snapshot the proxy routes off stays fresh. Heartbeat comments keep intermediaries
  // from timing the stream out. Both timers unref'd — the SERVER holds the process open, not the loops.
  const loop = setInterval(() => void tick().catch((e) => console.error(`[host] reconcile failed: ${(e as Error).message}`)), 2500)
  loop.unref()
  const ping = setInterval(() => { for (const c of sseClients) c.write(': ping\n\n') }, 10_000)
  ping.unref()

  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  listenOrExit(server, opts.port, {
    host, label: 'host dashboard', onListen: () => {
      console.log(`[host] dashboard on http://${isLoopback ? 'localhost' : host}:${opts.port} — all projects via /p/<projectId>/, list at /api/host/projects${isLoopback ? '' : ' — OPEN (no auth), bind wide only on a network you trust'}`)
    },
  })

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
