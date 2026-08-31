import test from 'node:test'
import assert from 'node:assert/strict'
import { DEAD_MS } from './heartbeat.js'

// The dead-man switch is armed FROM THE SUBSCRIBE INSTANT, on purpose: subscribeBoardLive's own comment
// says "a stream that never comes up at all still breaches". This pins that promise against the one case
// that makes it matter — the EventSource constructor itself throwing (a blocked or failed origin), where
// `es` stays null and there is no error event to fall back on. A switch that stops re-arming there gives
// up on exactly the stream that never started.
test('a stream whose constructor throws is retried on every dead window, not once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0
  const previous = globalThis.EventSource
  globalThis.EventSource = class { constructor() { attempts += 1; throw new Error('stream blocked') } }
  try {
    const { subscribeBoardLive } = await import('./data.js')
    const stop = subscribeBoardLive({ onBoard: () => {}, onStatus: () => {}, onLegacyChange: () => {} })
    assert.equal(attempts, 1, 'the subscribe itself attempts once')
    for (let window = 2; window <= 4; window++) {
      t.mock.timers.tick(DEAD_MS + 1)
      assert.equal(attempts, window,
        `after ${window - 1} dead window(s) it should have retried ${window} times, not ${attempts} — the switch stopped re-arming`)
    }
    stop()
    t.mock.timers.tick(DEAD_MS * 3)
    assert.equal(attempts, 4, 'unsubscribing stops the retries')
  } finally {
    if (previous === undefined) delete globalThis.EventSource
    else globalThis.EventSource = previous
  }
})
