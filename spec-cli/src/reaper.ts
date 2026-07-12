// @@@ socket-level connection reaper ([[spec-cli]]) - the ONE mechanism that actually reaps abandoned
// sockets, because Node's own http.Server timeouts do not. MEASURED (eval server-reaps-abandoned-connections,
// minimal http.createServer on Node 20/22/24): `headersTimeout` and `requestTimeout` DO NOT reap an
// incomplete request — a slow-loris (TCP connect + partial headers, never completed) survives indefinitely
// past the `connectionsCheckingInterval` sweep; only `keepAliveTimeout` (the idle-between-requests case) ever
// fires. So the abandoned-connection pileup protection those options claim (the 135-conn starvation that
// wedged the public port and triggered the mass-restore cascade) was NOT delivered. This helper is the real
// mechanism: an explicit per-socket deadline at the server boundary, independent of the platform sweep.
//
// It keys on "no request has completed yet / idle between requests" — never on response DURATION — so a
// long-lived ESTABLISHED stream (the /api/graph/stream SSE, a terminal WebSocket upgrade) is exempt for as
// long as it streams. The lifecycle per socket:
//   - on connect: arm the HEADER deadline — the socket must produce a fully-parsed request within it, else
//     it is a slow-loris and gets destroyed.
//   - on 'request' (headers complete → the request is in flight): disarm. An active request/response is
//     never reaped, however long its body/response takes (a slow board build or a streaming SSE response).
//   - when the response finishes/closes and no request is left in flight: re-arm the IDLE deadline (the
//     keep-alive window). Another request disarms it again; silence past it reaps the idle keep-alive socket.
//   - on 'upgrade' (WebSocket): mark exempt permanently — a persistent bidirectional stream, not a request
//     that ever "completes".
// The child's reaped close propagates back through the supervisor's raw-TCP proxy (which pairs socket
// halves), so a reaped upstream frees its public-side socket too — no separate raw timeout on the proxy,
// which would blind it to a legitimately-idle WS/SSE.
import type { Server as HttpServer } from 'node:http'
import type { Socket } from 'node:net'

export interface ReaperOptions {
  // ms a freshly-connected (or post-response idle) socket has to START a new request before it is reaped as a
  // slow-loris. Env: SPEXCODE_REAP_HEADER_MS. Default 30s.
  headerMs?: number
  // ms a keep-alive socket may sit idle BETWEEN requests before reaping. Env: SPEXCODE_REAP_IDLE_MS. Default 15s.
  idleMs?: number
}

interface SocketState { timer?: NodeJS.Timeout; active: number; upgraded: boolean }
const STATE = Symbol('spexcode.reaper')

function resolveMs(explicit: number | undefined, env: string | undefined, fallback: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Attach the reaper to a Node http/https server. Call it right after the server is created (before or just
// after listen); it hooks 'connection'/'request'/'upgrade' and needs no changes to the request handlers.
export function installConnectionReaper(server: HttpServer, opts: ReaperOptions = {}): void {
  const headerMs = resolveMs(opts.headerMs, process.env.SPEXCODE_REAP_HEADER_MS, 30000)
  const idleMs = resolveMs(opts.idleMs, process.env.SPEXCODE_REAP_IDLE_MS, 15000)

  server.on('connection', (socket: Socket) => {
    const state: SocketState = { timer: undefined, active: 0, upgraded: false }
    ;(socket as unknown as Record<symbol, SocketState>)[STATE] = state
    const disarm = () => { if (state.timer) { clearTimeout(state.timer); state.timer = undefined } }
    const arm = (ms: number) => { disarm(); state.timer = setTimeout(() => socket.destroy(), ms); state.timer.unref?.() }
    ;(state as SocketState & { arm: typeof arm; disarm: typeof disarm }).arm = arm
    ;(state as SocketState & { arm: typeof arm; disarm: typeof disarm }).disarm = disarm
    arm(headerMs)                 // slow-loris guard: first request's headers must complete within headerMs
    socket.once('close', disarm)  // socket gone → drop its pending timer
  })

  server.on('request', (req, res) => {
    const s = (req.socket as unknown as Record<symbol, SocketState & { arm(ms: number): void; disarm(): void }>)[STATE]
    if (!s) return
    s.active++
    s.disarm()                    // a request is in flight — never reap an active request/response
    let ended = false
    const done = () => {
      if (ended) return
      ended = true
      s.active--
      // response over and nothing else in flight → this is now an idle keep-alive socket; re-arm.
      if (s.active === 0 && !s.upgraded && !req.socket.destroyed) s.arm(idleMs)
    }
    res.once('finish', done)      // response fully sent
    res.once('close', done)       // response aborted / connection dropped
  })

  server.on('upgrade', (req) => {
    const s = (req.socket as unknown as Record<symbol, SocketState & { arm(ms: number): void; disarm(): void }>)[STATE]
    if (s) { s.upgraded = true; s.disarm() }   // persistent stream — exempt for its lifetime
  })
}
