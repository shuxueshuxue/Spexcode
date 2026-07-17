import test from 'node:test'
import assert from 'node:assert/strict'
import { createResilientSocket, SERVER_PING_MS, DEAD_MS } from './resilientSocket.js'

// The reconnect state machine is framework-agnostic by contract ([[reconnect]]): WebSocket impl, timers,
// and clock are injectable, so the silence watchdog — the detector for a HALF-OPEN link, where the peer is
// gone but no close event ever reaches the browser — is verifiable headlessly on a virtual clock. These
// tests pin the heartbeat contract: any inbound message proves liveness; an OPEN socket silent past
// `deadMs` is presumed dead, force-dropped, and reopened through the normal backoff machinery.

// virtual clock + timer wheel: setTimeout/setInterval driven by advance(), no real time.
function makeClock() {
  let now = 0, seq = 0
  const timers = new Map()
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id }
  const setI = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id }
  const clear = (id) => { timers.delete(id) }
  const advance = (ms) => {
    const end = now + ms
    for (;;) {
      let next = null, nid = 0
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id }
      if (!next) break
      now = next.at
      if (next.every) next.at = now + next.every
      else timers.delete(nid)
      next.fn()
    }
    now = end
  }
  return { now: () => now, setT, setI, clear, advance }
}

// fake WebSocket: opens after 5 virtual ms; never closes on its own unless told to.
function makeWS(clock, sockets) {
  return class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []
      sockets.push(this)
      clock.setT(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.() } }, 5)
    }
    send(d) { this.sent.push(d) }
    close() { this.readyState = 3; clock.setT(() => this.onclose?.(), 1) }
    emit(data) { this.onmessage?.({ data }) }
  }
}

function harness() {
  const clock = makeClock()
  const sockets = []
  const states = []
  const messages = []
  const sock = createResilientSocket({
    url: 'ws://x/api/sessions/abc/socket',
    WebSocketImpl: makeWS(clock, sockets),
    setTimeoutImpl: clock.setT, clearTimeoutImpl: clock.clear,
    setIntervalImpl: clock.setI, clearIntervalImpl: clock.clear,
    now: clock.now,
    onState: (s) => states.push(s),
    onMessage: (e) => messages.push(e.data),
  })
  return { clock, sockets, states, messages, sock }
}

// The heartbeat contract has ONE primitive per side of the wire: the server's ping cadence
// (TERM_PING_MS in spec-cli/src/index.ts) and this mirror of it — every other window is derived.
// Same pinning pattern as streamHeartbeat.test.mjs holds the SSE pair to the board stream's cadence.
test('the mirror matches the server ping cadence and the dead window derives from it', () => {
  assert.equal(SERVER_PING_MS, 10000) // = TERM_PING_MS in spec-cli/src/index.ts — change BOTH or neither
  assert.equal(DEAD_MS, 2.5 * SERVER_PING_MS)
})

test('an OPEN socket silent past the dead window is presumed dead and reopened', () => {
  const { clock, sockets, states } = harness()
  clock.advance(10)                    // socket #1 opens
  sockets[0].emit('ping')              // heard once
  clock.advance(2 * DEAD_MS + 10000)   // then total silence — and NO close event, ever (half-open)
  assert.ok(sockets.length > 1, 'a replacement socket must be constructed')
  assert.ok(states.includes('reconnecting'), 'the drop is loud — reconnecting is surfaced')
  // the replacement DID come up (an 'open' after the first 'reconnecting'); with a server that stays
  // silent forever the watchdog then rightly drops the replacement too, so the LAST state may be another
  // 'reconnecting' — that repeated drop is correct, not flapping.
  assert.ok(states.lastIndexOf('open') > states.indexOf('reconnecting'), 'the replacement link comes back up')
})

test('inbound traffic within the window — frames or pings — keeps the link alive', () => {
  const { clock, sockets } = harness()
  clock.advance(10)
  for (let i = 0; i < 20; i++) { sockets[0].emit('ping'); clock.advance(SERVER_PING_MS) }  // server cadence
  assert.equal(sockets.length, 1, 'a healthy-but-quiet link is never falsely dropped')
})

test('late events from the force-dropped zombie are ignored', () => {
  const { clock, sockets, messages } = harness()
  clock.advance(10)
  clock.advance(2 * DEAD_MS + 10000)   // watchdog drops socket #1, opens #2
  const before = messages.length
  sockets[0].emit('stale-bytes')       // the zombie speaks from the grave
  assert.equal(messages.length, before, 'superseded-socket guard holds for watchdog drops too')
})

test('an intentional close() stops the watchdog for good', () => {
  const { clock, sockets, sock } = harness()
  clock.advance(10)
  sock.close()
  clock.advance(5 * DEAD_MS)           // silence forever after an intentional close
  assert.equal(sockets.length, 1, 'no resurrection after close()')
})

test('a watchdog drop reopens with backoff, not a hammer', () => {
  const { clock, sockets } = harness()
  clock.advance(10)
  // one watchdog drop lands: the breach is noticed within half a ping of the DEAD_MS deadline…
  clock.advance(DEAD_MS + SERVER_PING_MS / 2 - 5)
  assert.equal(sockets.length, 1, '…and the replacement waits out the backoff delay first')
  clock.advance(1000)                  // past the 500ms base backoff
  assert.equal(sockets.length, 2, 'exactly one replacement is constructed per drop')
})
