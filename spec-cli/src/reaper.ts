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
//   - on socket birth: arm the HEADER deadline — the socket must produce a fully-parsed request within it,
//     else it is a slow-loris and gets destroyed.
//   - on 'request' (headers complete → the request is in flight): disarm. An active request/response is
//     never reaped, however long its body/response takes (a slow board build or a streaming SSE response).
//   - when the response finishes/closes and no request is left in flight: re-arm the IDLE deadline (the
//     keep-alive window). Another request disarms it again; silence past it reaps the idle keep-alive socket.
//   - on 'upgrade' (WebSocket): mark exempt permanently — a persistent bidirectional stream, not a request
//     that ever "completes".
//
// WHICH socket the deadline lives on is load-bearing. On a TLS server (the public gateway) 'connection'
// fires with the RAW TCP socket, but every 'request'/'upgrade' reports the wrapping TLSSocket — a deadline
// armed on the raw socket is unreachable from request handling, never disarms, and destroys every TLS
// connection at the header deadline no matter how alive it is (MEASURED, eval
// stream-survives-public-gateway: the dashboard's actively-pinging SSE + terminal WS through the https
// gateway died every ~30s — the "reconnecting…" storm). So per-socket state is keyed on the socket requests
// actually report: the TLSSocket (born at 'secureConnection') on a TLS server, the plain socket elsewhere.
// The raw pre-handshake phase gets its own header-deadline guard (a TCP connect that never completes the TLS
// handshake is the same slow-loris one layer down), linked raw→TLS by the connection's addr:port 4-tuple —
// public API only, no reliance on Node's private TLSSocket internals.
//
// The child's reaped close propagates back through the supervisor's raw-TCP proxy (which pairs socket
// halves), so a reaped upstream frees its public-side socket too — no separate raw timeout on the proxy,
// which would blind it to a legitimately-idle WS/SSE.
import type { Server as HttpServer } from 'node:http'
import type { Socket } from 'node:net'
import { Server as TlsServer } from 'node:tls'

export interface ReaperOptions {
  // ms a freshly-connected (or post-response idle) socket has to START a new request before it is reaped as a
  // slow-loris. Env: SPEXCODE_REAP_HEADER_MS. Default 30s.
  headerMs?: number
  // ms a keep-alive socket may sit idle BETWEEN requests before reaping. Env: SPEXCODE_REAP_IDLE_MS. Default 15s.
  idleMs?: number
}

interface SocketState { timer?: NodeJS.Timeout; active: number; upgraded: boolean; arm(ms: number): void; disarm(): void }
const STATE = Symbol('spexcode.reaper')

function resolveMs(explicit: number | undefined, env: string | undefined, fallback: number): number {
  if (typeof explicit === 'number' && explicit > 0) return explicit
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Attach the reaper to a Node http/https server. Call it right after the server is created (before or just
// after listen); it hooks the socket-birth event ('connection', or 'secureConnection' on TLS servers),
// 'request' and 'upgrade', and needs no changes to the request handlers.
export function installConnectionReaper(server: HttpServer, opts: ReaperOptions = {}): void {
  const headerMs = resolveMs(opts.headerMs, process.env.SPEXCODE_REAP_HEADER_MS, 30000)
  const idleMs = resolveMs(opts.idleMs, process.env.SPEXCODE_REAP_IDLE_MS, 15000)

  // per-socket tracking, on the SAME socket object 'request'/'upgrade' will report (see header comment).
  const track = (socket: Socket) => {
    const state: SocketState = {
      timer: undefined, active: 0, upgraded: false,
      disarm() { if (state.timer) { clearTimeout(state.timer); state.timer = undefined } },
      arm(ms: number) { state.disarm(); state.timer = setTimeout(() => socket.destroy(), ms); state.timer.unref?.() },
    }
    ;(socket as unknown as Record<symbol, SocketState>)[STATE] = state
    state.arm(headerMs)                 // slow-loris guard: first request's headers must complete within headerMs
    socket.once('close', state.disarm)  // socket gone → drop its pending timer
  }

  if (server instanceof TlsServer) {
    // TLS: requests report the TLSSocket, so that is where the deadline must live. The raw phase before the
    // handshake completes still needs a guard of its own; the 4-tuple key hands it off to the TLSSocket.
    const pendingHandshake = new Map<string, () => void>()
    server.on('connection', (raw: Socket) => {
      const key = `${raw.remoteAddress}:${raw.remotePort}`
      const timer = setTimeout(() => raw.destroy(), headerMs)
      timer.unref?.()
      const done = () => { clearTimeout(timer); pendingHandshake.delete(key) }
      pendingHandshake.set(key, done)
      raw.once('close', done)
    })
    server.on('secureConnection', (tlsSocket) => {
      pendingHandshake.get(`${tlsSocket.remoteAddress}:${tlsSocket.remotePort}`)?.()
      track(tlsSocket as unknown as Socket)
    })
  } else {
    server.on('connection', track)
  }

  server.on('request', (req, res) => {
    const s = (req.socket as unknown as Record<symbol, SocketState>)[STATE]
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
    const s = (req.socket as unknown as Record<symbol, SocketState>)[STATE]
    if (s) { s.upgraded = true; s.disarm() }   // persistent stream — exempt for its lifetime
  })
}
