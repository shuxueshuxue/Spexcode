const OPEN = 1 // WebSocket.OPEN — identical (1) in the browser and in Node's `ws`.
const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000] // ms, indexed by attempt; the last value is the cap.
const STABLE_MS = 3000 // a connection that stays open this long is healthy → reset backoff to its base.
// Heartbeat contract ([[reconnect]]): the server pings every terminal socket on a fixed cadence
// (TERM_PING_MS in spec-cli's socket route), so a healthy link is GUARANTEED inbound traffic — the ping
// both keeps an idle link warm through NAT/tunnel idle-reapers and gives this side something to hold the
// socket to. SERVER_PING_MS is the client's MIRROR of that promise — held to it by
// resilientSocket.test.mjs, the same way data.js's STREAM_HEARTBEAT_MS pins the SSE stream's cadence. It
// is the ONE timing primitive on this side of the wire; DEAD_MS derives from it (2.5× — absorbs one lost
// ping plus jitter, the same multiplier as the SSE stream's dead window): an OPEN socket that hears
// nothing for DEAD_MS is presumed DEAD — the half-open link a NAT/tunnel tears down without ever
// delivering a close event. Detection is EVENT-DRIVEN, not a polling loop: a dead-man's switch, one
// one-shot timer re-armed by every inbound message — on a healthy link it never fires and nothing wakes.
export const SERVER_PING_MS = 10000
export const DEAD_MS = 2.5 * SERVER_PING_MS

export function createResilientSocket({
  url,
  binaryType = 'arraybuffer',
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : undefined,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  backoff = DEFAULT_BACKOFF,
  stableMs = STABLE_MS,
  onOpen = () => {},
  onMessage = () => {},
  onState = () => {},
}) {
  let ws = null
  let attempt = 0 // consecutive failed/short-lived connects; indexes `backoff`, reset by a stable open.
  let closedByUs = false
  let reopenTimer = 0
  let stableTimer = 0
  let deadTimer = 0 // the dead-man's switch — re-armed by open + EVERY inbound message (frames and pings alike).

  // url may be a function, re-resolved on every (re)connect — so a handshake query (e.g. the live pane size)
  // reflects the moment of THIS connect, not a value frozen at first open.
  const resolveUrl = typeof url === 'function' ? url : () => url

  const clearStable = () => { if (stableTimer) { clearTimeoutImpl(stableTimer); stableTimer = 0 } }

  const connect = () => {
    onState(attempt === 0 ? 'connecting' : 'reconnecting')
    let sock
    try { sock = new WebSocketImpl(resolveUrl()) } catch { scheduleReopen(); return }
    ws = sock
    try { sock.binaryType = binaryType } catch { /* some impls fix binaryType at construction */ }
    sock.onopen = () => {
      if (sock !== ws) return // a superseded socket fired late — ignore it.
      armDeadman()
      onState('open')
      // only a connection that survives `stableMs` resets the backoff. A server that flaps (open → immediate
      // close) therefore keeps escalating toward the cap instead of hammering it every base interval.
      stableTimer = setTimeoutImpl(() => { attempt = 0; stableTimer = 0 }, stableMs)
      onOpen(api)
    }
    sock.onmessage = (e) => { if (sock === ws) { armDeadman(); onMessage(e) } }
    sock.onclose = () => { if (sock === ws) handleDrop() }
    sock.onerror = () => { /* a close event always follows; let onclose drive the reopen */ }
  }

  const handleDrop = () => {
    clearStable()
    clearDeadman()
    if (closedByUs) return // intentional teardown — do not resurrect.
    scheduleReopen()
  }

  // The dead-man's switch — the ONLY detector for a half-open link (peer gone, no close event will ever
  // fire, readyState stuck OPEN). EVENT-DRIVEN, no polling loop and no clock reads: every inbound message
  // re-arms one one-shot timer, so on a healthy link it never fires; DEAD_MS of total silence lets it fire
  // once. It then presumes the socket dead: supersede it first (its late events must be ignored),
  // best-effort close the zombie, and hand recovery to the same backoff/reopen path a genuine close takes.
  const clearDeadman = () => { if (deadTimer) { clearTimeoutImpl(deadTimer); deadTimer = 0 } }
  const armDeadman = () => {
    clearDeadman()
    deadTimer = setTimeoutImpl(() => {
      deadTimer = 0
      if (closedByUs || !ws || ws.readyState !== OPEN) return
      const zombie = ws
      ws = null
      clearStable()
      try { zombie.close() } catch { /* already dying */ }
      scheduleReopen()
    }, DEAD_MS)
  }

  const scheduleReopen = () => {
    onState('reconnecting')
    const delay = backoff[Math.min(attempt, backoff.length - 1)]
    attempt++
    reopenTimer = setTimeoutImpl(() => { reopenTimer = 0; connect() }, delay)
  }

  const api = {
    // send returns false (a no-op) while the socket is mid-reconnect, matching the read-only view's contract:
    // the wheel→copy-mode scroll just doesn't register for the instant the link is down.
    send(data) { if (ws && ws.readyState === OPEN) { ws.send(data); return true } return false },
    isOpen() { return !!ws && ws.readyState === OPEN },
    close() {
      closedByUs = true
      clearDeadman()
      if (reopenTimer) { clearTimeoutImpl(reopenTimer); reopenTimer = 0 }
      clearStable()
      if (ws) { try { ws.close() } catch { /* already closing */ } }
      ws = null
    },
    get raw() { return ws },
  }

  connect()
  return api
}
