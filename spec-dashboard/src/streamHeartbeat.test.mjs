import test from 'node:test'
import assert from 'node:assert/strict'
import { streamStale, STREAM_HEARTBEAT_MS, STREAM_DEAD_MS } from './data.js'

// The EventSource wiring itself (listeners, reopen, the setInterval watchdog) resists a node unit test — no
// EventSource/DOM here — so it's covered by the hidden-tab-catchup e2e scenario. What IS pure and worth
// pinning is the stale/dead DECISION the watchdog reads, and the constant's tie to the server ping contract.

test('the dead window is 2.5x the server ping cadence', () => {
  assert.equal(STREAM_HEARTBEAT_MS, 10000)
  assert.equal(STREAM_DEAD_MS, 25000)
  assert.equal(STREAM_DEAD_MS, 2.5 * STREAM_HEARTBEAT_MS)
})

test('a stream heard from within the dead window is NOT stale', () => {
  const now = 1_000_000
  assert.equal(streamStale(now, now), false)                       // just heard
  assert.equal(streamStale(now - STREAM_HEARTBEAT_MS, now), false) // one ping ago
  assert.equal(streamStale(now - STREAM_DEAD_MS, now), false)      // exactly at the window edge (>, not >=)
})

test('a stream silent past the dead window IS stale', () => {
  const now = 1_000_000
  assert.equal(streamStale(now - STREAM_DEAD_MS - 1, now), true)   // one ms over
  assert.equal(streamStale(now - 73_000, now), true)              // the measured 73s-frozen case
})
