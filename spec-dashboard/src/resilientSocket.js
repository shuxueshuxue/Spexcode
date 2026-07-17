const OPEN = 1 // WebSocket.OPEN — identical (1) in the browser and in Node's `ws`.
const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000] // ms, indexed by attempt; the last value is the cap.
const STABLE_MS = 3000 // a connection that stays open this long is healthy → reset backoff to its base.
// Heartbeat contract ([[reconnect]]): the server pings every terminal socket every 10s (index.ts), so a
// healthy link is GUARANTEED inbound traffic. An OPEN socket silent past 2.5× that cadence is presumed
// DEAD — the half-open link a NAT/tunnel tears down without ever delivering a close event — and is
// force-dropped into the normal reopen machinery. 2.5× absorbs one lost ping plus jitter.
const DEAD_MS = 25000
const WATCH_MS = 5000 // how often the silence watchdog looks at the clock.

export function createResilientSocket({
  url,
  binaryType = 'arraybuffer',
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : undefined,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = Date.now,
  backoff = DEFAULT_BACKOFF,
  stableMs = STABLE_MS,
  deadMs = DEAD_MS,
  watchMs = WATCH_MS,
  onOpen = () => {},
  onMessage = () => {},
  onState = () => {},
}) {
  let ws = null
  let attempt = 0 // consecutive failed/short-lived connects; indexes `backoff`, reset by a stable open.
  let closedByUs = false
  let reopenTimer = 0
  let stableTimer = 0
  let lastHeardAt = now() // bumped by open + EVERY inbound message (frames and keep-alive pings alike).

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
      lastHeardAt = now()
      onState('open')
      // only a connection that survives `stableMs` resets the backoff. A server that flaps (open → immediate
      // close) therefore keeps escalating toward the cap instead of hammering it every base interval.
      stableTimer = setTimeoutImpl(() => { attempt = 0; stableTimer = 0 }, stableMs)
      onOpen(api)
    }
    sock.onmessage = (e) => { if (sock === ws) { lastHeardAt = now(); onMessage(e) } }
    sock.onclose = () => { if (sock === ws) handleDrop() }
    sock.onerror = () => { /* a close event always follows; let onclose drive the reopen */ }
  }

  const handleDrop = () => {
    clearStable()
    if (closedByUs) return // intentional teardown — do not resurrect.
    scheduleReopen()
  }

  const scheduleReopen = () => {
    onState('reconnecting')
    const delay = backoff[Math.min(attempt, backoff.length - 1)]
    attempt++
    reopenTimer = setTimeoutImpl(() => { reopenTimer = 0; connect() }, delay)
  }

  // The silence watchdog — the ONLY detector for a half-open link (peer gone, no close event will ever
  // fire, readyState stuck OPEN). An open socket that has heard NOTHING — no frame, no server ping — for
  // `deadMs` is presumed dead: supersede it first (its late events must be ignored), best-effort close the
  // zombie, and hand recovery to the same backoff/reopen path a genuine close takes.
  const watchdog = setIntervalImpl(() => {
    if (closedByUs || !ws || ws.readyState !== OPEN) return
    if (now() - lastHeardAt <= deadMs) return
    const zombie = ws
    ws = null
    clearStable()
    try { zombie.close() } catch { /* already dying */ }
    scheduleReopen()
  }, watchMs)

  const api = {
    // send returns false (a no-op) while the socket is mid-reconnect, matching the read-only view's contract:
    // the wheel→copy-mode scroll just doesn't register for the instant the link is down.
    send(data) { if (ws && ws.readyState === OPEN) { ws.send(data); return true } return false },
    isOpen() { return !!ws && ws.readyState === OPEN },
    close() {
      closedByUs = true
      clearIntervalImpl(watchdog)
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
