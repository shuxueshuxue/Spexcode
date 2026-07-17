import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVER_PING_MS, DEAD_MS, createDeadman } from './heartbeat.js'

// The shared client heartbeat contract (heartbeat.js) — ONE cadence primitive for BOTH live channels
// (the board SSE stream in data.js, the terminal WebSocket in resilientSocket.js), the dead window
// derived from it, and the dead-man switch both sides arm. The EventSource wiring itself resists a node
// unit test (no EventSource/DOM here) — that's covered by the dead-stream e2e scenarios. What IS pure and
// worth pinning is the cadence's tie to the server ping contract, and the switch's fire/re-arm/disarm law.

test('one cadence primitive, held to the server, dead window derived', () => {
  // = the SSE ping cadence in spec-cli/src/graphStream.ts AND TERM_PING_MS in spec-cli/src/index.ts —
  // change all three together or none.
  assert.equal(SERVER_PING_MS, 10000)
  assert.equal(DEAD_MS, 2.5 * SERVER_PING_MS)
})

// virtual clock: setTimeout driven by advance(), no real time — same shape as resilientSocket.test.mjs.
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
  return { setT, clear, advance }
}

const harness = () => {
  const clock = makeClock()
  let fired = 0
  const deadman = createDeadman(() => { fired++ }, { setTimeoutImpl: clock.setT, clearTimeoutImpl: clock.clear })
  return { clock, deadman, fired: () => fired }
}

test('a switch re-armed within the window never fires — liveness costs zero wakeups', () => {
  const { clock, deadman, fired } = harness()
  deadman.arm()
  for (let i = 0; i < 20; i++) { clock.advance(SERVER_PING_MS); deadman.arm() }   // server cadence
  assert.equal(fired(), 0)
})

test('DEAD_MS of total silence fires the switch exactly once, at the deadline', () => {
  const { clock, deadman, fired } = harness()
  deadman.arm()
  clock.advance(DEAD_MS - 1)
  assert.equal(fired(), 0)                    // quiet-but-alive: inside the window
  clock.advance(1)
  assert.equal(fired(), 1)                    // the deadline
  clock.advance(10 * DEAD_MS)
  assert.equal(fired(), 1)                    // one-shot: silence after a breach doesn't re-fire unless re-armed
})

test('disarm stops the switch for good', () => {
  const { clock, deadman, fired } = harness()
  deadman.arm()
  deadman.disarm()
  clock.advance(10 * DEAD_MS)
  assert.equal(fired(), 0)
})
