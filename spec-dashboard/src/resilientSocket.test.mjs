import test from 'node:test'
import assert from 'node:assert/strict'
import { createResilientSocket } from './resilientSocket.js'
import { SERVER_PING_MS, DEAD_MS } from './heartbeat.js'

// The reconnect state machine is framework-agnostic by contract ([[reconnect]]): WebSocket impl and timers
// are injectable, so the one dead-man can be verified across CONNECTING, OPEN, and CLOSING. Construction,
// open, and every inbound message move its deadline; expiry supersedes through the ordinary backoff path.

// virtual clock + timer wheel: setTimeout driven by advance(), no real time.
function makeClock() {
  let now = 0, seq = 0
  const timers = new Map()
  const setT = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id }
  const clear = (id) => { timers.delete(id) }
  const advance = (ms) => {
    const end = now + ms
    for (;;) {
      let next = null, nid = 0
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id }
      if (!next) break
      now = next.at
      timers.delete(nid)
      next.fn()
    }
    now = end
  }
  return { now: () => now, setT, clear, advance }
}

// fake WebSocket: opens after 5 virtual ms unless held in CONNECTING; CLOSING never completes on its own.
function makeWS(clock, sockets, phase = 'OPEN') {
  return class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []
      sockets.push(this)
      if (phase !== 'CONNECTING') {
        clock.setT(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen?.() } }, 5)
      }
      if (phase === 'CLOSING') clock.setT(() => { if (this.readyState === 1) this.readyState = 2 }, 6)
    }
    send(d) { this.sent.push(d) }
    close() { this.readyState = 3; clock.setT(() => this.onclose?.(), 1) }
    emit(data) { this.onmessage?.({ data }) }
  }
}

function harness({ phase = 'OPEN' } = {}) {
  const clock = makeClock()
  const sockets = []
  const states = []
  const messages = []
  const sock = createResilientSocket({
    url: 'ws://x/api/sessions/abc/socket',
    WebSocketImpl: makeWS(clock, sockets, phase),
    setTimeoutImpl: clock.setT, clearTimeoutImpl: clock.clear,
    onState: (s) => states.push(s),
    onMessage: (e) => messages.push(e.data),
  })
  return { clock, sockets, states, messages, sock }
}

// The heartbeat contract has ONE primitive for the whole client (heartbeat.js, shared with the SSE board
// stream) — every other window is derived. streamHeartbeat.test.mjs pins the primitive to the server
// cadences; here we pin that THIS channel consumes that shared switch, not a private copy.
test('the socket holds the link to the shared heartbeat contract', () => {
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

for (const phase of ['CONNECTING', 'CLOSING']) {
  test(`a ${phase} socket silent past the dead window is presumed dead and reopened`, () => {
    const { clock, sockets, states } = harness({ phase })
    clock.advance(DEAD_MS + 1000)
    assert.equal(sockets.length, 2, 'one replacement is constructed through the ordinary backoff path')
    assert.ok(states.includes('reconnecting'), 'the handshake breach is loud')
  })
}

test('inbound traffic within the window — frames or pings — keeps the link alive', () => {
  const { clock, sockets } = harness()
  clock.advance(10)
  for (let i = 0; i < 20; i++) { sockets[0].emit('ping'); clock.advance(SERVER_PING_MS) }  // server cadence
  assert.equal(sockets.length, 1, 'a healthy-but-quiet link is never falsely dropped')
  assert.deepEqual(sockets[0].sent, Array(20).fill('pong'), 'every server ping receives the transport pong')
})

test('late events from the force-dropped zombie are ignored', () => {
  const { clock, sockets, messages } = harness()
  clock.advance(10)
  clock.advance(2 * DEAD_MS + 10000)   // watchdog drops socket #1, opens #2
  const before = messages.length
  sockets[0].emit('stale-bytes')       // the zombie speaks from the grave
  assert.equal(messages.length, before, 'superseded-socket guard holds for watchdog drops too')
})

for (const phase of ['CONNECTING', 'OPEN', 'CLOSING']) {
  test(`an intentional close() in ${phase} disarms the dead-man switch for good`, () => {
    const { clock, sockets, sock } = harness({ phase })
    clock.advance(phase === 'CONNECTING' ? 1 : 10)
    sock.close()
    clock.advance(5 * DEAD_MS)
    assert.equal(sockets.length, 1, 'no resurrection after close()')
  })
}

test('a dead-man drop reopens with backoff, not a hammer', () => {
  const { clock, sockets } = harness()
  clock.advance(10)
  // the switch fires EXACTLY at lastHeard + DEAD_MS (event-driven — no check-cadence slack)…
  clock.advance(DEAD_MS)
  assert.equal(sockets.length, 1, '…and the replacement waits out the backoff delay first')
  clock.advance(1000)                  // past the 500ms base backoff
  assert.equal(sockets.length, 2, 'exactly one replacement is constructed per drop')
})
