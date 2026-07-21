import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  completeExportNodeIds,
  declaredLatest,
  mergeBasePath,
  nodeScore,
  parsePorcelainPaths,
  parsePorcelainRenames,
  renderExportHtml,
  scopedScenarioReadings,
  scopeSessionScenarioRows,
  selectImpactedScenarios,
  sessionEvalSummary,
  sessionEvalContentRevision,
  SessionEvalProjectionCache,
  sessionEvalNodeCandidate,
  unknownCoveragePaths,
  type ExportModel,
  type SessionEvalNode,
} from './sessioneval.js'
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

test('unknown coverage is changed frontend code on a node with no eval.md', () => {
  const changed = new Set(['src/View.jsx', 'src/covered.jsx', 'src/server.ts', 'README.md'])
  assert.deepEqual(unknownCoveragePaths(['src/View.jsx', 'src/server.ts'], changed), ['src/View.jsx'])
  assert.deepEqual(unknownCoveragePaths(['src/covered.jsx'], changed), ['src/covered.jsx'])
  assert.deepEqual(unknownCoveragePaths(['src/server.ts', 'README.md'], changed), [])
})

test('session scope controlled fixture keeps code, contract, stale, missing and session-only while dropping the untouched sibling', () => {
  const base = [
    scenario('code-fresh', { code: ['src/changed.ts'] }),
    scenario('code-stale', { code: ['src/changed.ts'] }),
    scenario('code-missing', { code: ['src/changed.ts'] }),
    scenario('contract-missing'),
    scenario('session-only'),
    scenario('untouched-sibling'),
  ]
  const current = base.map((item) => item.name === 'contract-missing'
    ? { ...item, expected: 'changed semantic expectation' }
    : item)
  const evals = [
    { ...reading({ scenario: 'code-fresh', verdict: { status: 'pass' }, fresh: true }), inSession: false },
    { ...reading({ scenario: 'code-stale', verdict: { status: 'pass' }, fresh: false, staleAxes: ['code'] }), inSession: false },
    { ...reading({ scenario: 'session-only', verdict: { status: 'pass' }, fresh: true }), inSession: true },
    { ...reading({ scenario: 'untouched-sibling', verdict: { status: 'pass' }, fresh: true }), inSession: false },
  ]
  const scoped = scopeSessionScenarioRows(
    current,
    base,
    current.map(({ name, expected, tags, code }) => ({ name, expected, tags, code })),
    [],
    new Set(['src/changed.ts', '.spec/n/eval.md']),
    true,
    evals,
  )

  assert.deepEqual(scoped.scenarios.map((item) => [item.name, item.impact]), [
    ['code-fresh', ['code']],
    ['code-stale', ['code']],
    ['code-missing', ['code']],
    ['contract-missing', ['contract']],
    ['session-only', ['measurement']],
  ])
  assert.deepEqual(scoped.evals.map((item) => [item.scenario, item.fresh]), [
    ['code-fresh', true],
    ['code-stale', false],
    ['session-only', true],
  ])

  const projection = scopedScenarioReadings(scoped.scenarios, scoped.evals)
  assert.deepEqual(projection.unmeasured.map((item) => item.name), ['code-missing', 'contract-missing'])
  assert.equal(nodeScore(true, projection.latest, scoped.scenarios.length), 'stalePass')
})

test('session scope loads a dirty sidecar before commit so a diagnostic reading can supply measurement impact', () => {
  const current = [scenario('diagnostic')]
  const dirty = parsePorcelainPaths(' M .spec/n/evals.ndjson\0R  .spec/new/evals.ndjson\0.spec/old/evals.ndjson\0')
  assert.deepEqual([...dirty], ['.spec/n/evals.ndjson', '.spec/new/evals.ndjson', '.spec/old/evals.ndjson'])
  assert.deepEqual([...parsePorcelainRenames('R  .spec/new/eval.md\0.spec/old/eval.md\0')], [
    ['.spec/new/eval.md', '.spec/old/eval.md'],
  ])
  assert.equal(sessionEvalNodeCandidate(
    current, [], '.spec/n/eval.md', '.spec/n/evals.ndjson', new Set(), dirty,
  ), true)
  assert.equal(sessionEvalNodeCandidate(
    current, [], '.spec/n/eval.md', '.spec/n/evals.ndjson', new Set(), new Set(['README.md']),
  ), false)
})

test('pure eval.md rename reads the merge-base contract from the old path and selects no scenario', () => {
  const currentPath = '.spec/new-parent/n/eval.md'
  const oldPaths = new Map([[currentPath, '.spec/old-parent/n/eval.md']])
  const current = [scenario('stable')]
  assert.equal(mergeBasePath(currentPath, oldPaths), '.spec/old-parent/n/eval.md')
  assert.deepEqual(selectImpactedScenarios(current, current, [], new Set([currentPath]), true, new Set()), [])
})

test('export projection counts and renders affected missing scenarios and retains changed-only nodes', () => {
  assert.deepEqual(completeExportNodeIds(['changed-only'], ['measured']), ['changed-only', 'measured'])
  const model: ExportModel = {
    id: 'session-id', node: 'measured', branch: 'node/measured', title: 'Measured', generatedAt: '2026-07-20',
    ahead: 1, dirtyNonRuntime: 0, gates: [], score: { passed: 1, total: 2, fresh: 1 }, otherFiles: [],
    nodes: [
      {
        id: 'measured', title: 'Measured', hue: 150, desc: '', files: [], additions: 0, deletions: 0,
        hasEvalFile: true, uncoveredFrontend: false, affectedScenarios: 2, score: 'empty',
        readings: [{
          scenario: 'fresh', expected: 'fresh expected', impact: ['code'], verdict: { status: 'pass' },
          fresh: true, staleAxes: [], score: 'pass', ts: '2026-07-20', evidence: { kind: 'none' },
        }],
        unmeasured: [{ scenario: 'missing', expected: 'missing expected', impact: ['contract'] }],
      },
      {
        id: 'changed-only', title: 'Changed only', hue: 200, desc: '', additions: 1, deletions: 0,
        hasEvalFile: true, uncoveredFrontend: false, affectedScenarios: 0, score: 'empty', readings: [], unmeasured: [],
        files: [{
          path: '.spec/changed-only/spec.md', status: 'modified', additions: 1, deletions: 0,
          patch: '+changed', oldText: 'old', newText: 'new', truncated: false, omitted: false,
        }],
      },
    ],
  }
  const html = renderExportHtml(model)
  assert.match(html, /1\/2 passing/)
  assert.match(html, /missing/)
  assert.match(html, /unmeasured/)
  assert.match(html, /\.spec\/changed-only\/spec\.md/)
  assert.match(html, /no declared scenario is affected by this worktree/)
})

const summary = (measured: number) => ({
  measured, total: measured, pass: measured, fail: 0, review: 0, blind: 0, unknown: 0,
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

test('sessionEvalSummary is the declared-bounded full/graph projection', () => {
  const nodes: SessionEvalNode[] = [{
    id: 'n', title: 'n', hue: 1, desc: '', hasEvalFile: true, uncoveredFrontend: false,
    unknownCoverage: ['src/unknown.jsx'],
    scenarios: [
      { name: 'pass', expected: '', impact: ['code'] },
      { name: 'fail', expected: '', impact: ['code'] },
      { name: 'stale', expected: '', impact: ['code'] },
      { name: 'blind', expected: '', impact: ['code'] },
    ],
    evals: [
      { ...reading({ scenario: 'pass', fresh: true, verdict: { status: 'pass' } }), inSession: false },
      { ...reading({ scenario: 'fail', fresh: true, verdict: { status: 'fail' } }), inSession: false },
      { ...reading({ scenario: 'stale', fresh: false, verdict: { status: 'pass' } }), inSession: false },
    ],
  }]
  assert.deepEqual(sessionEvalSummary(nodes), {
    measured: 3, total: 4, pass: 1, fail: 1, review: 1, blind: 1, unknown: 1,
  })
})

test('projection cache coalesces a burst to one latest-generation build and publication', async () => {
  let builds = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: `r${builds}`, summary: summary(builds) }
  }, () => { publishes++ }, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  assert.equal(cache.snapshot(sessions).get('s')?.phase, 'loading')
  await cache.idle()
  assert.equal(cache.get('s')?.phase, 'ready')
  assert.equal(builds, 1)
  for (let i = 0; i < 60; i++) cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 1, 'idle snapshots authorize zero additional computes')

  cache.invalidate({ id: 's' })
  cache.invalidate({ id: 's' })
  cache.invalidate({ id: 's' })
  const updating = cache.snapshot(sessions).get('s')!
  assert.equal(updating.phase, 'updating')
  assert.equal(updating.generation, 3)
  assert.equal(updating.lastKnown?.value.measured, 1)
  await cache.idle()

  assert.equal(builds, 2, 'three burst writes authorize only one F(inputs@g=3)')
  assert.equal(publishes, 2, 'one initial and one burst completion publication')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 3, phase: 'ready', revision: 'r2', value: summary(2),
  })
})

test('projection cache discards an old response after a newer generation and stays single-flight', async () => {
  const old = deferred<any>(), fresh = deferred<any>()
  let builds = 0, active = 0, maxActive = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++; active++; maxActive = Math.max(maxActive, active)
    const result = await (builds === 1 ? old.promise : fresh.promise)
    active--
    return result
  }, () => { publishes++ }, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  cache.snapshot(sessions)
  await Promise.resolve()
  cache.invalidate({ id: 's' })
  const updating = cache.snapshot(sessions).get('s')!
  assert.equal(updating.generation, 1)
  old.resolve({ kind: 'stable', revision: 'old', summary: summary(1) })
  await Promise.resolve()
  await Promise.resolve()
  fresh.resolve({ kind: 'stable', revision: 'new', summary: summary(2) })
  await cache.idle()

  assert.equal(maxActive, 1)
  assert.equal(publishes, 1, 'the discarded generation publishes nothing')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 1, phase: 'ready', revision: 'new', value: summary(2),
  })
})

test('observer holds fence in-flight work and resubscribe computes the missed window once', async () => {
  const stale = deferred<any>()
  let builds = 0
  let latest = 1
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    if (builds === 2) return stale.promise
    return { kind: 'stable', revision: `r${latest}`, summary: summary(latest) }
  }, () => {}, 'epoch')
  const sessions = [{ id: 's', path: '/wt' }]

  cache.snapshot(sessions)
  await cache.idle()
  cache.invalidate({ id: 's' })
  cache.snapshot(sessions)
  await Promise.resolve()

  assert.equal(cache.holdObserver('refs', 'all'), true)
  assert.equal(cache.holdObserver('worktree', { path: '/wt' }), true)
  latest = 3 // a direct edit in the interval where both observers are absent
  stale.resolve({ kind: 'stable', revision: 'stale', summary: summary(2) })
  await cache.idle()
  cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 2, 'an observer-held snapshot cannot authorize a replacement compute')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 3, phase: 'updating',
    lastKnown: { generation: 0, revision: 'r1', value: summary(1) },
  })

  assert.equal(cache.releaseObserver('worktree'), true)
  cache.snapshot(sessions)
  await cache.idle()
  assert.equal(builds, 2, 'restoring one observer cannot mask a second failed input axis')
  assert.equal(cache.releaseObserver('refs'), true)
  cache.snapshot(sessions)
  await cache.idle()

  assert.equal(builds, 3, 'the fully restored observer set authorizes one latest-window rescan')
  assert.deepEqual(cache.get('s'), {
    epoch: 'epoch', generation: 5, phase: 'ready', revision: 'r3', value: summary(3),
  })
})

test('cold scoped demand waits through composed observer holds, then returns the authoritative empty projection', async () => {
  let builds = 0
  const cache = new SessionEvalProjectionCache(async () => {
    builds++
    return { kind: 'stable', revision: 'empty-r1', summary: summary(0) }
  }, () => {}, 'epoch')
  const sessions = [{ id: 'new-session', path: '/wt/new-session' }]

  cache.holdObserver('refs', 'all')
  cache.holdObserver('worktree', { path: '/wt/new-session' })
  assert.equal(cache.snapshot(sessions).get('new-session')?.phase, 'updating')

  let settled = false
  const demand = cache.waitUntilObservable('new-session', '/wt/new-session', 1_000).then(async (observable) => {
    settled = true
    assert.equal(observable, true)
    cache.snapshot(sessions)
    await cache.idle()
    return cache.get('new-session')
  })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(builds, 0, 'a held cold demand must not certify a projection')

  cache.releaseObserver('worktree')
  await Promise.resolve()
  assert.equal(settled, false, 'restoring one observer must not mask the remaining hold')
  assert.equal(builds, 0)

  cache.releaseObserver('refs')
  const projection = await demand
  assert.equal(builds, 1, 'recovery authorizes exactly one authoritative build')
  assert.deepEqual(projection, {
    epoch: 'epoch', generation: 2, phase: 'ready', revision: 'empty-r1', value: summary(0),
  })
})

test('projection cache batches initial misses into one publication', async () => {
  let builds = 0, publishes = 0
  const cache = new SessionEvalProjectionCache(async (id) => {
    builds++
    return { kind: 'stable', revision: `r-${id}`, summary: summary(1) }
  }, () => { publishes++ }, 'epoch')

  const rows = cache.snapshot([
    { id: 'a', path: '/wt/a' },
    { id: 'b', path: '/wt/b' },
    { id: 'c', path: '/wt/c' },
  ])
  assert.deepEqual([...rows.values()].map((row) => row.phase), ['loading', 'loading', 'loading'])
  await cache.idle()

  assert.equal(builds, 3, 'the one batch computes one lean projection per cold session')
  assert.equal(publishes, 1, 'the batch completion emits one canonical graph nudge, not N pushes')
})

test('content revision covers dirty source, index, rename, sidecar, remark, and main movement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-revision-'))
  const remarks = mkdtempSync(join(tmpdir(), 'spex-session-remarks-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const priorIssuesDir = process.env.SPEXCODE_ISSUES_DIR
  process.env.SPEXCODE_ISSUES_DIR = remarks
  try {
    git('init', '-b', 'main')
    git('config', 'user.email', 'eval@example.test')
    git('config', 'user.name', 'Eval Test')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, '.spec/n'), { recursive: true })
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 1\n')
    writeFileSync(join(root, '.spec/n/eval.md'), 'scenario contract\n')
    writeFileSync(join(root, '.spec/n/evals.ndjson'), '{"scenario":"s"}\n')
    git('add', '.')
    git('commit', '-m', 'base')
    git('checkout', '-q', '-b', 'node/test')

    const revisions = [await sessionEvalContentRevision(root)]
    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2\n')
    revisions.push(await sessionEvalContentRevision(root))
    git('add', 'src/a.ts')
    revisions.push(await sessionEvalContentRevision(root))
    renameSync(join(root, 'src/a.ts'), join(root, 'src/b.ts'))
    revisions.push(await sessionEvalContentRevision(root))
    writeFileSync(join(root, '.spec/n/evals.ndjson'), '{"scenario":"s","retracts":"old"}\n')
    revisions.push(await sessionEvalContentRevision(root))
    writeFileSync(join(remarks, 'freshness.md'), [
      '---', 'concern: eval: n · s', 'by: reviewer', 'status: open',
      'created: 2026-07-20T00:00:00.000Z', '---', '', 'freshness concern', '',
      '<!-- reply: reviewer @ 2026-07-20T00:00:00.000Z :: rid=r1 sha=abc -->',
      'needs another reading', '',
    ].join('\n'))
    revisions.push(await sessionEvalContentRevision(root))
    const tree = git('rev-parse', 'main^{tree}')
    const movedMain = git('commit-tree', tree, '-p', 'main', '-m', 'main move')
    git('update-ref', 'refs/heads/main', movedMain)
    revisions.push(await sessionEvalContentRevision(root))

    assert.equal(new Set(revisions).size, revisions.length)
  } finally {
    if (priorIssuesDir === undefined) delete process.env.SPEXCODE_ISSUES_DIR
    else process.env.SPEXCODE_ISSUES_DIR = priorIssuesDir
    rmSync(root, { recursive: true, force: true })
    rmSync(remarks, { recursive: true, force: true })
  }
})
