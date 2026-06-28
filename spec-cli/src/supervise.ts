// SO_REUSEPORT is ENOTSUP on macOS/Node, so the supervisor owns the public port as a raw-TCP proxy and
// runs the Hono server as a child on a private port (raw piping carries WS upgrades too).
import net from 'node:net'
import http from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { statSync, readdirSync, type Dirent } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installProcessGuards } from './resilience.js'
import { resolvePublicConfig, startGateway, ensureDashboardBuilt, resolveDistDir } from './gateway.js'

// the supervisor OWNS the public port, so it must outlive any transient throw: an uncaught error here is
// logged and survived, never an exit that closes the port (and the tmux session) and takes the frontend down.
installProcessGuards()

const here = dirname(fileURLToPath(import.meta.url))
const tsx = join(here, '..', 'node_modules', '.bin', 'tsx')   // this package's own tsx (no build step)
const entry = join(here, 'index.ts')                          // the real Hono server
const publicPort = Number(process.env.PORT || 8787)

// @@@ public mode ([[public-mode]]) - with `spex serve --public`, the supervisor is NOT the internet face:
// the gateway is. The raw-TCP proxy retreats to a loopback internal port (the trusted boundary local agents
// reach) and the password-gated TLS gateway takes the public port, proxying /api + WS back to that loopback
// port. Off → unchanged: the proxy itself owns the public port and SPEXCODE_API_URL points there.
const publicCfg = resolvePublicConfig(join(here, '..', '..'))
// the port the raw-TCP proxy actually binds: a private loopback port in public mode, the public port otherwise.
const proxyPort = publicCfg ? await freePort() : publicPort
// what launched agents inherit as their `spex` endpoint — ALWAYS the loopback proxy, so local agents never
// meet the password gate (loopback is the trust boundary). Equals the public port when public mode is off.
const childApiBase = `http://127.0.0.1:${proxyPort}`

// every package src tree the child imports at runtime; spec-dashboard is absent (its own vite/HMR).
const repoRoot = join(here, '..', '..')
const watchRoots = [
  here,                                  // spec-cli/src — the backend's own source
  join(repoRoot, 'spec-forge', 'src'),
  join(repoRoot, 'spec-yatsu', 'src'),
]

type Backend = { port: number; child: ChildProcess }
let current: Backend | null = null   // which internal port new proxy connections forward to
let reloading = false                // single-flight guard for reload()
let pending = false                  // a code change arrived mid-reload → reload again when done

// grab an ephemeral port by binding :0, then release it for the child to claim (negligible rebind race).
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) })
  })
}

// poll GET /health until 200; ~15s budget (150 × 100ms) covers a slow tsx+Hono cold start. False → keep old.
function waitHealthy(port: number, tries = 150): Promise<boolean> {
  return new Promise((resolve) => {
    const retry = (left: number) => { if (left <= 1) resolve(false); else setTimeout(() => attempt(left - 1), 100) }
    const attempt = (left: number) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (r) => {
        r.resume()
        if (r.statusCode === 200) resolve(true); else retry(left)
      })
      req.on('error', () => retry(left))
      req.on('timeout', () => { req.destroy(); retry(left) })
    }
    attempt(tries)
  })
}

// boot a fresh backend child on a free internal port and wait until it's serving.
async function boot(): Promise<Backend | null> {
  const port = await freePort()
  // PORT pins the child's PRIVATE bind port; SPEXCODE_API_URL pins everything the child SPAWNS (launched
  // sessions + their hooks) at the PUBLIC port, so a launched agent's own `spex` reaches the stable proxy
  // and never inherits this ephemeral, soon-retired port (apiBase() prefers SPEXCODE_API_URL over PORT).
  const child = spawn(tsx, [entry], { stdio: 'inherit', env: { ...process.env, PORT: String(port), SPEXCODE_API_URL: process.env.SPEXCODE_API_URL || childApiBase } })
  // if the ACTIVE backend dies unexpectedly (crash, OOM), restart it so the public port keeps serving.
  // Planned retirement sets current to the NEW child first, so the old child's exit fails this identity
  // check and is ignored. boot()'s ~5s health budget rate-limits any crash loop.
  child.on('exit', (code, sig) => {
    if (current?.child === child) { console.error(`[supervisor] active backend exited (${code ?? sig}) — restarting`); current = null; void reload('crash') }
  })
  if (await waitHealthy(port)) return { port, child }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
  return null
}

// boot → health-gate → atomic flip → drain old. The flip is a single assignment; the old child is killed
// only after a drain delay, so a connection mid-flip is never refused.
async function reload(reason: string): Promise<void> {
  if (reloading) { pending = true; return }
  reloading = true
  try {
    do {
      pending = false
      const next = await boot()
      if (!next) { console.error(`[supervisor] new backend failed health check (${reason}) — keeping current`); break }
      const old = current
      current = next   // atomic flip: new connections now route to `next`
      console.log(`[supervisor] reloaded (${reason}) → backend :${next.port}`)
      if (old) setTimeout(() => { try { old.child.kill('SIGTERM') } catch { /* already gone */ } }, 500)
    } while (pending)
  } finally { reloading = false }
}

// the public port: a raw byte pipe to the current backend. Works for HTTP and WS upgrades alike.
const proxy = net.createServer((client) => {
  const target = current
  if (!target) { client.destroy(); return }
  const up = net.connect(target.port, '127.0.0.1')
  client.setNoDelay(true); up.setNoDelay(true)   // proxy a request promptly — don't let Nagle add latency
  const bail = () => { client.destroy(); up.destroy() }
  client.on('error', bail); up.on('error', bail)
  client.pipe(up); up.pipe(client)
})

const shutdown = () => { try { current?.child.kill('SIGTERM') } catch { /* */ } process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const first = await boot()
if (!first) { console.error('[supervisor] initial backend failed to start'); process.exit(1) }
current = first
if (publicCfg) {
  // public mode: the raw proxy stays on loopback; the password-gated gateway owns the public port.
  const distDir = resolveDistDir() // bundled <pkg>/dashboard-dist when installed, else monorepo spec-dashboard/dist
  ensureDashboardBuilt(repoRoot, distDir)
  proxy.listen(proxyPort, '127.0.0.1', () => console.log(`spec-cli supervisor on loopback :${proxyPort} (zero-downtime reloads, backend :${first.port})`))
  startGateway({ publicPort, upstreamPort: proxyPort, password: publicCfg.password, tls: publicCfg.tls, distDir })
} else {
  proxy.listen(publicPort, () => console.log(`spec-cli supervisor serving on http://localhost:${publicPort} (zero-downtime reloads, backend :${first.port})`))
}

// watch every imported source tree; debounce a burst of writes (a merge touching several files across
// packages) into one reload. A root that can't be watched (a package absent in some checkout) is logged
// and skipped — the supervisor owns the public port and must never die over a missing watch.
// fs.watch — even recursive — is NOT reliable for a long-lived supervisor: its inotify watches are silently
// dropped when a watched dir is rewritten (a git merge, a `materialize`) and NEVER re-established, so reloads
// quietly stop (observed: the watcher fired a few times then went deaf for hours). A cheap mtime poll can't go
// deaf: every 2s, take the newest .ts/.js/.json mtime across the trees; a jump triggers the debounced reload
// (a burst of writes still lands as one). Polling a few small src trees is negligible cost.
let timer: NodeJS.Timeout | undefined
const newestMtime = (dir: string): number => {
  let max = 0
  let entries: Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }   // a tree absent in some checkout → skip
  for (const e of entries) {
    if (e.isDirectory()) { if (e.name !== 'node_modules') max = Math.max(max, newestMtime(join(dir, e.name))) }
    else if (/\.(ts|js|mjs|json)$/.test(e.name)) { try { max = Math.max(max, statSync(join(dir, e.name)).mtimeMs) } catch { /* raced unlink */ } }
  }
  return max
}
const scanMtime = (): number => { let m = 0; for (const root of watchRoots) m = Math.max(m, newestMtime(root)); return m }
let lastMtime = scanMtime()   // baseline at boot — only a LATER change reloads
setInterval(() => {
  const m = scanMtime()
  if (m > lastMtime) { lastMtime = m; clearTimeout(timer); timer = setTimeout(() => void reload('code change'), 150) }
}, 2000).unref()
