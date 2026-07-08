import { test } from 'node:test'
import assert from 'node:assert/strict'

import { declaredLatest, nodeScore } from './proof.js'
import type { EvalTimeline, EvalEntry } from './evaltab.js'

// a reading with sensible defaults; override per case (mirrors show.test.ts).
function reading(over: Partial<EvalEntry>): EvalEntry {
  return {
    scenario: 's', expected: '', codeSha: 'abcdef0123456789', blob: null, evaluator: 'manual@1',
    ts: '2026-06-22T00:00:00.000Z', fresh: true, staleAxes: [], blobState: 'none', ...over,
  }
}
const timeline = (readings: EvalEntry[], over: Partial<EvalTimeline> = {}): EvalTimeline =>
  ({ node: 'n', hasYatsu: true, scenarios: [], retractions: [], dangling: [], readings, ...over })

// ---- declaredLatest: the proof scores DECLARED scenarios, never residual sidecar readings ----
// The bug this pins: a scenario removed from yatsu.md leaves its old reading in the append-only
// yatsu.evals.ndjson. The proof used to score every reading that EXISTED (latestPerScenario over the raw
// sidecar), so a retired reading became a phantom card + skewed the passed/total ribbon + dragged the node
// score — while the dashboard (score.jsx scenarioStates, driven by the DECLARED set) never showed it. Now the
// proof reads the same declared-bounded latest-per-scenario as every other eval face, so the two agree.

test('declaredLatest: a retired scenario’s residual reading is dropped; the declared one survives', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'retired', verdict: { status: 'pass' }, fresh: false, staleAxes: ['scenario'] }),
    ],
    { scenarios: [{ name: 'alive', expected: 'stays green' }] },
  )
  const latest = declaredLatest(tl)
  assert.deepEqual(latest.map((r) => r.scenario), ['alive'])   // retired never flows into readings/ribbon
})

test('declaredLatest vs the raw latest: the fix is exactly the declared-set filter', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'retired', verdict: { status: 'pass' }, fresh: false, staleAxes: ['scenario'] }),
    ],
    { scenarios: [{ name: 'alive', expected: 'x' }] },
  )
  const latest = declaredLatest(tl)
  // node score + ribbon (passed/total) mirror the dashboard: one declared scenario, fresh-passing → green 1/1.
  assert.equal(nodeScore(tl.hasYatsu, latest), 'pass')
  assert.equal(latest.length, 1)                                             // total = 1 (not 2)
  assert.equal(latest.filter((r) => r.fresh && r.verdict?.status === 'pass').length, 1)   // passed = 1

  // the BUG the fix closes: scoring the raw readings (what the proof did before) would keep the retired,
  // stale reading — a phantom card, a 1/2 ribbon, and a grey stalePass node — none of which the dashboard shows.
  assert.equal(nodeScore(tl.hasYatsu, tl.readings), 'stalePass')
  assert.equal(tl.readings.length, 2)
})

test('declaredLatest: newest reading per DECLARED scenario wins (history is not double-counted)', () => {
  const tl = timeline(
    [
      reading({ scenario: 'alive', ts: '2026-07-02', verdict: { status: 'pass' }, fresh: true }),
      reading({ scenario: 'alive', ts: '2026-07-01', verdict: { status: 'fail' }, fresh: true }),
    ],
    { scenarios: [{ name: 'alive', expected: 'x' }] },
  )
  const latest = declaredLatest(tl)
  assert.equal(latest.length, 1)
  assert.equal(latest[0].ts, '2026-07-02')          // first-seen (newest) wins
  assert.equal(nodeScore(tl.hasYatsu, latest), 'pass')
})

test('declaredLatest: a node with no declared scenarios scores nothing, even with residual readings', () => {
  const tl = timeline(
    [reading({ scenario: 'gone', verdict: { status: 'pass' }, fresh: true })],
    { scenarios: [] },
  )
  assert.deepEqual(declaredLatest(tl), [])
})
