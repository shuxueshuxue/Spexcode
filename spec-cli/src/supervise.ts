// @@@ supervisor - zero-downtime backend reloads. SO_REUSEPORT (two processes binding 8787 so the new
// one is live before the old drains) is unsupported on this platform (macOS/Node → ENOTSUP), so instead
// the supervisor OWNS the public port (8787) as a tiny raw-TCP proxy and runs the real Hono server as a
// CHILD on a private internal port. On a code change we boot a NEW child, wait for its GET /health to
// answer 200, atomically flip the proxy's upstream to it, then retire the old child after a short drain.
// The public socket never closes, so port 8787 has no gap — a reload (e.g. a node merge touching
// spec-cli/src) is invisible to API callers. Raw byte-piping also carries the WebSocket upgrades
// (terminal socket / pty bridges) for new connections transparently; in-flight WS on the old child drop
// at drain time and the client reconnects, exactly as the no-supervisor reload already did.
import net from 'node:net'
import http from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const tsx = join(here, '..', 'node_modules', '.bin', 'tsx')   // this package's own tsx (no build step)
const entry = join(here, 'index.ts')                          // the real Hono server
const publicPort = Number(process.env.PORT || 8787)

type Backend = { port: number; child: ChildProcess }
let current: Backend | null = null   // which internal port new proxy connections forward to
let reloading = false                // single-flight guard for reload()
let pending = false                  // a code change arrived mid-reload → reload again when done

// @@@ freePort - grab an ephemeral port by binding :0 and reading it back, then release it for the
// child to claim. The release→rebind window is a negligible local-dev race.
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) })
  })
}

// @@@ waitHealthy - poll GET /health on the child until it answers 200. This is the gate that makes the
// flip safe: we never route traffic at a child that isn't serving yet. ~15s budget (150 × 100ms) is
// generous on purpose — a tsx+Hono cold start on a loaded box can take several seconds, and overshooting
// only delays a flip, never drops a connection (the old child keeps serving the whole time). A child
// that never goes healthy returns false, so the old one is kept rather than flipped to a dead port.
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
  const child = spawn(tsx, [entry], { stdio: 'inherit', env: { ...process.env, PORT: String(port) } })
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

// @@@ reload - boot → health-gate → atomic flip → drain old. The flip is a single assignment, so a
// connection arriving mid-flip lands on whichever child its capture saw; both are alive (old is killed
// only after the drain delay), so no connection is ever refused. A change during a reload sets `pending`
// so we immediately reload once more against the latest source.
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
proxy.listen(publicPort, () => console.log(`spec-cli supervisor serving on http://localhost:${publicPort} (zero-downtime reloads, backend :${first.port})`))

// watch the source tree; debounce a burst of writes (a merge touching several files) into one reload.
let timer: NodeJS.Timeout | undefined
watch(here, { recursive: true }, (_evt, file) => {
  if (file && !/\.(ts|js|mjs|json)$/.test(file)) return
  clearTimeout(timer)
  timer = setTimeout(() => void reload('code change'), 150)
})
