const OPEN = 1 // WebSocket.OPEN — identical (1) in the browser and in Node's `ws`.
const DEFAULT_BACKOFF = [500, 1000, 2000, 4000, 8000] // ms, indexed by attempt; the last value is the cap.
const STABLE_MS = 3000 // a connection that stays open this long is healthy → reset backoff to its base.

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
      onState('open')
      // only a connection that survives `stableMs` resets the backoff. A server that flaps (open → immediate
      // close) therefore keeps escalating toward the cap instead of hammering it every base interval.
      stableTimer = setTimeoutImpl(() => { attempt = 0; stableTimer = 0 }, stableMs)
      onOpen(api)
    }
    sock.onmessage = (e) => { if (sock === ws) onMessage(e) }
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

  const api = {
    // send returns false (a no-op) while the socket is mid-reconnect, matching the read-only view's contract:
    // the wheel→copy-mode scroll just doesn't register for the instant the link is down.
    send(data) { if (ws && ws.readyState === OPEN) { ws.send(data); return true } return false },
    isOpen() { return !!ws && ws.readyState === OPEN },
    close() {
      closedByUs = true
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
