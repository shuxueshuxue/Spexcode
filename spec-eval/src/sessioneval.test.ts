import { test } from 'node:test'
import assert from 'node:assert/strict'

import { declaredLatest, nodeScore, selectImpactedScenarios, unknownCoveragePaths } from './sessioneval.js'
import type { EvalTimeline, EvalEntry } from './evaltab.js'
import type { Scenario } from './scenarios.js'

// a reading with sensible defaults; override per case (mirrors show.test.ts).
function reading(over: Partial<EvalEntry>): EvalEntry {
  return {
    scenario: 's', expected: '', codeSha: 'abcdef0123456789', blob: null, evaluator: 'manual@1',
    ts: '2026-06-22T00:00:00.000Z', fresh: true, staleAxes: [], blobState: 'none', ...over,
  }
}
const timeline = (readings: EvalEntry[], over: Partial<EvalTimeline> = {}): EvalTimeline =>
  ({ node: 'n', hasEvalFile: true, scenarios: [], retractions: [], dangling: [], readings, ...over })

// ---- declaredLatest: the proof scores DECLARED scenarios, never residual sidecar readings ----
// The bug this pins: a scenario removed from eval.md leaves its old reading in the append-only
// evals.ndjson. The proof used to score every reading that EXISTED (latestPerScenario over the raw
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
  assert.equal(nodeScore(tl.hasEvalFile, latest), 'pass')
  assert.equal(latest.length, 1)                                             // total = 1 (not 2)
  assert.equal(latest.filter((r) => r.fresh && r.verdict?.status === 'pass').length, 1)   // passed = 1

  // the BUG the fix closes: scoring the raw readings (what the proof did before) would keep the retired,
  // stale reading — a phantom card, a 1/2 ribbon, and a grey stalePass node — none of which the dashboard shows.
  assert.equal(nodeScore(tl.hasEvalFile, tl.readings), 'stalePass')
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
  assert.equal(nodeScore(tl.hasEvalFile, latest), 'pass')
})

test('declaredLatest: a node with no declared scenarios scores nothing, even with residual readings', () => {
  const tl = timeline(
    [reading({ scenario: 'gone', verdict: { status: 'pass' }, fresh: true })],
    { scenarios: [] },
  )
  assert.deepEqual(declaredLatest(tl), [])
})

const scenario = (name: string, over: Partial<Scenario> = {}): Scenario => ({
  name,
  description: `${name} description`,
  expected: `${name} expected`,
  tags: ['backend-api'],
  ...over,
})

test('session scope selects each scenario by its own code axis, not by shared eval.md membership', () => {
  const current = [
    scenario('changed', { code: ['src/changed.ts'] }),
    scenario('untouched-sibling', { code: ['src/other.ts'] }),
    scenario('inherits-node-code'),
  ]
  const selected = selectImpactedScenarios(
    current,
    current,
    ['src/node.ts'],
    new Set(['src/changed.ts', 'src/node.ts']),
    false,
    new Set(),
  )

  assert.deepEqual(selected.map(({ scenario: item, impact }) => [item.name, impact]), [
    ['changed', ['code']],
    ['inherits-node-code', ['code']],
  ])
})

test('session scope compares only the changed scenario semantic contract', () => {
  const base = [
    scenario('semantic-change'),
    scenario('metadata-only', { tags: ['desktop'], code: ['src/old.ts'] }),
    scenario('untouched-sibling'),
  ]
  const current = [
    scenario('semantic-change', { expected: 'new expected behavior' }),
    scenario('metadata-only', { tags: ['mobile'], code: ['src/new.ts'] }),
    scenario('untouched-sibling'),
    scenario('new-contract'),
  ]
  const selected = selectImpactedScenarios(current, base, [], new Set(['node/eval.md']), true, new Set())

  assert.deepEqual(selected.map(({ scenario: item, impact }) => [item.name, impact]), [
    ['semantic-change', ['contract']],
    ['new-contract', ['contract']],
  ])
})

test('session measurement keeps an otherwise untouched scenario without consulting freshness', () => {
  const current = [scenario('measured'), scenario('unmeasured')]
  const selected = selectImpactedScenarios(current, current, [], new Set(), false, new Set(['measured']))

  assert.deepEqual(selected.map(({ scenario: item, impact }) => [item.name, impact]), [
    ['measured', ['measurement']],
  ])
})

test('unknown coverage is changed frontend code with no declared scenario axis', () => {
  const changed = new Set(['src/View.jsx', 'src/covered.jsx', 'src/server.ts', 'README.md'])
  assert.deepEqual(unknownCoveragePaths([], ['src/View.jsx'], changed), ['src/View.jsx'])
  assert.deepEqual(unknownCoveragePaths(
    [scenario('explicit', { code: ['src/covered.jsx'] })],
    ['src/View.jsx', 'src/covered.jsx'],
    changed,
  ), ['src/View.jsx'])
  assert.deepEqual(unknownCoveragePaths(
    [scenario('inherits')],
    ['src/View.jsx', 'src/covered.jsx'],
    changed,
  ), [])
})
