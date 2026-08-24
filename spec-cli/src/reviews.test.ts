import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedEvalNeighbors, focusNodes, measuredSequence, paginateReview, projectEvalDetail, reviewPageNumber, scopedEvalReviewItems, timelineEvalReviewItems, trunkEvalReviewItems } from './reviews.js'
import { orderRowsOf } from '../../spec-eval/src/sessioneval.js'
// The shared browser/server engine is deliberately plain JS — the same module the server folds counts with,
// so this test measures the real canonical path rather than a re-implementation.
import { evalFilterModel, tokenFilterState } from '@spexcode/spec-core/review'

const model = {
  sections: { open: 61, closed: 7 },
  section: { key: 'state', value: 'open', options: [{ value: 'open', count: 61 }] },
  facets: { store: { value: '', options: [{ value: '' }, { value: 'local' }, { value: 'github' }] } },
}

test('count and facets describe the full set while items contain one 25-row slice', () => {
  const source = Array.from({ length: 68 }, (_, id) => ({ id, state: id < 61 ? 'open' : 'closed' }))
  const shown = source.slice(0, 61)
  const page = paginateReview(source, shown, model, '2', { source })
  assert.equal(page.page, 2)
  assert.equal(page.perPage, 25)
  assert.equal(page.items.length, 25)
  assert.deepEqual(page.items.map((item) => item.id), Array.from({ length: 25 }, (_, index) => index + 25))
  assert.equal(page.total, 61)
  assert.equal(page.sourceTotal, 68)
  assert.equal(page.pageCount, 3)
  assert.deepEqual(page.counts, { open: 61, closed: 7 })
  assert.deepEqual(page.facets.store.options.map((option) => option.value), ['', 'local', 'github'])
})

test('overflow preserves the requested page and continues real prev/next targets without clamping', () => {
  const source = Array.from({ length: 1000 }, (_, id) => ({ id }))
  for (const requested of [41, 999999]) {
    const page = paginateReview(source, source, model, String(requested), { source })
    assert.equal(page.page, requested)
    assert.deepEqual(page.items, [])
    assert.equal(page.prev, requested - 1)
    assert.equal(page.next, requested + 1)
  }
  const last = paginateReview(source, source, model, '40', { source })
  assert.equal(last.items.length, 25)
  assert.equal(last.next, null)
})

test('revision is stable for one snapshot and changes with observable input', () => {
  const source = [{ id: 1 }]
  const a = paginateReview(source, source, model, 1, { source })
  const b = paginateReview(source, source, model, 1, { source })
  const c = paginateReview([{ id: 2 }], [{ id: 2 }], model, 1, { source: [{ id: 2 }] })
  const nextPage = paginateReview(source, source, model, '2', { source })
  assert.equal(a.revision, b.revision)
  assert.notEqual(a.revision, c.revision)
  assert.notEqual(a.revision, nextPage.revision, 'page is part of the rendered slice identity')
  assert.equal(reviewPageNumber('0'), 1)
  assert.equal(reviewPageNumber('999999'), 999999)
})

test('trunk and scoped eval sources produce one tagged stable item vocabulary', () => {
  const reading = (scenario: string, ts: string, inSession = false) => ({
    scenario, ts, fresh: true, verdict: { status: 'pass' }, inSession,
  })
  const trunk = trunkEvalReviewItems([{ id: 'n', hue: 10, scenarios: [{ name: 'blind' }, { name: 'a' }], evals: [reading('a', '2026-01-01')] }])
  assert.deepEqual(trunk.map((item) => [item.node, item.scenario, item.filterKind, item.state]), [
    ['n', 'a', 'result', 'pass'],
    ['n', 'blind', 'blind', undefined],
  ])

  const scoped = scopedEvalReviewItems({
    id: 's', node: 'n', branch: 'node/n', title: 'n',
    summary: { measured: 3, total: 4, pass: 3, fail: 0, review: 0, blind: 1, unknown: 0 },
    evalRevision: { epoch: 'test', generation: 1, content: 'fixture' },
    impact: { base: 'base', head: 'head', revision: 'revision', nodes: [] },
    nodes: [{
      id: 'n', title: 'n', hue: 10, desc: '', hasEvalFile: true, uncoveredFrontend: false,
      unknownCoverage: [], causes: [], scenarios: [{ name: 'blind', expected: '', impact: ['code'] }, { name: 'legacy', expected: '', impact: ['code'] }, { name: 'own', expected: '', impact: ['code'] }, { name: 'inherited', expected: '', impact: ['code'] }],
      evals: [reading('inherited', '2026-01-03') as any, reading('own', '2026-01-02', true) as any, reading('legacy', '') as any],
    }],
  })
  assert.deepEqual(scoped.map((item) => [item.scenario, item.filterKind]), [
    ['inherited', 'result'],
    ['own', 'result'],
    ['legacy', 'result'],
    ['blind', 'blind'],
  ])
  assert.deepEqual(scoped.map((item) => [item.scenario, item.impact]), [
    ['inherited', ['code']],
    ['own', ['code']],
    ['legacy', ['code']],
    ['blind', ['code']],
  ], 'measured and blind rows carry the same canonical scenario impact')
})

test('deferred freshness rows remain explicit and orderable without claiming a verdict', () => {
  const items = trunkEvalReviewItems([{
    id: 'n',
    scenarios: [{ name: 'deferred' }, { name: 'pass' }, { name: 'blind' }],
    evals: [
      { scenario: 'deferred', ts: '2026-08-04', freshnessDeferred: true, verdict: { status: 'pass' } },
      { scenario: 'pass', ts: '2026-08-03', fresh: true, verdict: { status: 'pass' } },
    ],
  }])
  assert.deepEqual(items.map((item: any) => [item.scenario, item.filterKind, item.state]), [
    ['deferred', 'deferred', 'deferred'],
    ['pass', 'result', 'pass'],
    ['blind', 'blind', undefined],
  ])
})

test('node timeline review projects one latest reading per declared scenario', () => {
  const items = timelineEvalReviewItems({
    scenarios: [{ name: 'measured' }, { name: 'blind' }],
    readings: [
      { scenario: 'measured', ts: '2026-08-03T12:00:00.000Z', fresh: true, verdict: { status: 'pass' } },
      { scenario: 'measured', ts: '2026-08-02T12:00:00.000Z', fresh: true, verdict: { status: 'fail' } },
      { scenario: 'retired', ts: '2026-08-01T12:00:00.000Z', fresh: true, verdict: { status: 'pass' } },
    ],
    dangling: [{ scenario: 'retired', threadId: 'dangling-1' }],
  } as any, 'node')

  assert.deepEqual(items.map((item: any) => [item.scenario, item.filterKind, item.ts]), [
    ['blind', 'unmeasured', undefined],
    ['measured', 'result', '2026-08-03T12:00:00.000Z'],
    ['retired', 'dangling', undefined],
  ])
})

test('node timeline keeps deferred freshness explicit instead of throwing', () => {
  const [item] = timelineEvalReviewItems({
    scenarios: [{ name: 'pending' }],
    readings: [{ scenario: 'pending', ts: '2026-08-03T12:00:00.000Z', freshnessDeferred: true, verdict: { status: 'pass' } }],
    dangling: [],
  } as any, 'node')
  assert.deepEqual([item.filterKind, item.state], ['deferred', 'deferred'])
})

test('one detail projection returns only selected history and at most five lightweight neighbors', () => {
  const items = Array.from({ length: 9 }, (_, index) => ({
    node: 'n', scenario: `s${index}`, state: index % 2 ? 'fail' : 'pass', filterKind: 'result', secret: `row-${index}`,
  }))
  const history = [
    { scenario: 's4', ts: 'new', evidence: [{ hash: 'selected-new' }] },
    { scenario: 'other', ts: 'leak', evidence: [{ hash: 'must-not-ship' }] },
    { scenario: 's4', ts: 'old', evidence: [{ hash: 'selected-old' }] },
  ]
  const detail = projectEvalDetail(items, history, 'n', 's4')

  assert.equal(detail.selected?.scenario, 's4')
  assert.deepEqual(detail.history.map((reading) => reading.scenario), ['s4', 's4'])
  assert.equal(detail.neighbors.prev.length + detail.neighbors.next.length, 5)
  assert.deepEqual(detail.neighbors.prev.map((row) => row.scenario), ['s3', 's2'])
  assert.deepEqual(detail.neighbors.next.map((row) => row.scenario), ['s5', 's6', 's7'])
  assert.deepEqual(Object.keys(detail.neighbors.prev[0]).sort(), ['node', 'scenario', 'state'])
  assert.equal(detail.neighbors.total, 9)
  assert.equal(detail.neighbors.index, 4)
  assert.equal(detail.neighbors.order, 'default')
  assert.equal(detail.availability, 'measured')
  assert.equal(detail.scopeFallback, null)
  assert.equal(detail.requestedScope, null)
  assert.equal(detail.revision, projectEvalDetail(items, history, 'n', 's4').revision)
  assert.notEqual(detail.revision, projectEvalDetail(items, history.slice(0, 1), 'n', 's4').revision)
  const scoped = { scope: 's', summary: { measured: 9, total: 9, pass: 5, fail: 4, review: 0, blind: 0, unknown: 0 } }
  const changedSummary = { scope: 's', summary: { ...scoped.summary, unknown: 1 } }
  assert.notEqual(projectEvalDetail(items, history, 'n', 's4', scoped).revision, projectEvalDetail(items, history, 'n', 's4', changedSummary).revision)
})

test('detail neighbor budget refills at boundaries and missing selections stay honest', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ node: 'n', scenario: `s${index}`, state: 'pass', filterKind: 'result' }))
  assert.deepEqual(boundedEvalNeighbors(items as any, 'n', 's0', (r: any) => String((items as any[]).find((i: any) => i.node === r.node && i.scenario === r.scenario)?.state ?? 'empty')).next.map((row) => row.scenario), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(boundedEvalNeighbors(items as any, 'n', 's7', (r: any) => String((items as any[]).find((i: any) => i.node === r.node && i.scenario === r.scenario)?.state ?? 'empty')).prev.map((row) => row.scenario), ['s6', 's5', 's4', 's3', 's2'])
  const missing = projectEvalDetail(items, [{ scenario: 'absent' }], 'n', 'absent', {
    scope: 'scope-1',
    summary: { measured: 8, total: 8, pass: 8, fail: 0, review: 0, blind: 0, unknown: 0 },
    evalRevision: { epoch: 'epoch', generation: 3, content: 'content' },
  })
  assert.equal(missing.selected, null)
  assert.equal(missing.availability, 'missing')
  assert.equal(missing.neighbors.index, null)
  assert.equal(missing.neighbors.total, 8)
  assert.deepEqual(missing.evalRevision, { epoch: 'epoch', generation: 3, content: 'content' })
  assert.equal(missing.summary?.total, 8)
})

test('detail separates source fallback from declared-but-unmeasured and missing scenarios', () => {
  const [blind] = trunkEvalReviewItems([{ id: 'n', scenarios: [{ name: 'never' }], evals: [] }])
  const unmeasured = projectEvalDetail([blind], [], 'n', 'never')
  assert.equal(unmeasured.selected, null)
  assert.equal(unmeasured.history.length, 0)
  assert.equal(unmeasured.availability, 'unmeasured')

  const fallback = projectEvalDetail([{ node: 'n', scenario: 'read', filterKind: 'result' }], [{ scenario: 'read' }], 'n', 'read', {
    requestedScope: 'gone-session', scopeFallback: 'trunk',
  })
  assert.equal(fallback.scope, null)
  assert.equal(fallback.requestedScope, 'gone-session')
  assert.equal(fallback.scopeFallback, 'trunk')
  assert.equal(fallback.availability, 'measured')
})

test('eval verdict counts split freshness ONCE on the server, over the whole population, before the slice', () => {
  const reading = (scenario: string, status: string, fresh: boolean) => ({
    scenario, ts: `2026-01-0${scenario.length}`, fresh, verdict: { status },
  })
  const nodes = [{
    id: 'n', hue: 10,
    scenarios: [{ name: 'p' }, { name: 'pp' }, { name: 'ppp' }, { name: 'f' }, { name: 'ff' }, { name: 'blind' }],
    evals: [
      reading('p', 'pass', true), reading('pp', 'pass', false), reading('ppp', 'pass', false),
      reading('f', 'fail', true), reading('ff', 'fail', false),
    ],
  }]
  const items = trunkEvalReviewItems(nodes)
  const page = (query: string) => {
    const filtered = evalFilterModel(items, tokenFilterState(query, 'eval'), { sessions: [], defaultKind: 'all', defaultSection: '' })
    return paginateReview(items, filtered.shown, filtered, 1, { items, query })
  }

  const all = page('is:eval')
  // the measured verdicts carry their remeasurement debt in the count itself; unmeasured owns no reading
  // and stays one number. Both halves are folded here, once — no surface re-derives them from `items`.
  assert.deepEqual(all.counts, { fail: { fresh: 1, stale: 1 }, pass: { fresh: 1, stale: 2 }, unmeasured: 1 })
  // population preserved: each split re-adds to what selecting that verdict actually returns.
  assert.equal(page('is:eval verdict:pass').total, 3)
  assert.equal(page('is:eval verdict:fail').total, 2)
  assert.equal(all.total, 6)
  // the compact/menu face of the same sections keeps the verdict's WHOLE count.
  assert.deepEqual(all.section?.options.map((option) => [option.value, option.count]), [['', undefined], ['fail', 2], ['pass', 3], ['unmeasured', 1]])

  // freshness is part of the REST of the query, so freshness:fresh zeroes the stale halves structurally.
  const fresh = page('is:eval freshness:fresh')
  assert.deepEqual(fresh.counts, { fail: { fresh: 1, stale: 0 }, pass: { fresh: 1, stale: 0 }, unmeasured: 0 })
  assert.equal(fresh.total, 2)
  assert.deepEqual(page('is:eval freshness:stale').counts, { fail: { fresh: 0, stale: 1 }, pass: { fresh: 0, stale: 2 }, unmeasured: 0 })
})

// @@@ the focused detail's one real hazard, pinned - a detail open derives its index/total/neighbours from
// the freshness-free sequence while its states come from the few nodes it actually measured. Those are two
// code paths over the same population, so they must order it IDENTICALLY or Back and "up next" would point
// somewhere the list page does not. Nothing else in the response can reveal a divergence.
test('the freshness-free sequence orders the population exactly as the full model does', () => {
  const at = (scenario: string, ts: string) => ({
    scenario, ts, codeSha: 'c', blob: null, blobState: 'none' as const, fresh: true, staleAxes: [],
    expected: '', verdict: { status: 'pass' as const }, inSession: false,
  })
  const nodes: any[] = [
    {
      id: 'beta', title: 'beta', hue: 1, desc: '', hasEvalFile: true, uncoveredFrontend: false,
      unknownCoverage: [], causes: [],
      scenarios: [{ name: 'same-ts', expected: '' }, { name: 'newest', expected: '' }, { name: 'never-run', expected: '' }],
      evals: [at('newest', '2026-03-01'), at('same-ts', '2026-01-01')],
    },
    {
      id: 'alpha', title: 'alpha', hue: 2, desc: '', hasEvalFile: true, uncoveredFrontend: false,
      unknownCoverage: [], causes: [],
      scenarios: [{ name: 'same-ts', expected: '' }, { name: 'middle', expected: '' }],
      evals: [at('middle', '2026-02-01'), at('same-ts', '2026-01-01')],
    },
  ]
  const model: any = {
    id: 's', node: null, branch: null, title: 's', ahead: 0, dirtyNonRuntime: 0, gates: [], nodes,
    impact: { base: 'b', head: 'h', revision: 'r', nodes: [] },
    summary: { measured: 4, total: 5, pass: 4, fail: 0, review: 0, blind: 1, unknown: 0 },
    evalRevision: { epoch: 'e', generation: 1, content: 'c' },
  }
  const full = scopedEvalReviewItems(model)
    .filter((item: any) => item.filterKind === 'result')
    .map((item: any) => ({ node: String(item.node), scenario: String(item.scenario) }))
  assert.deepEqual(measuredSequence(orderRowsOf(nodes)), full,
    'the cheap sequence and the full model must agree row for row, ties included')
  assert.ok(full.length === 4, 'the blind row stays out of the measured sequence, as the detail projection expects')
})

// @@@ the window must hold at EVERY position, not just the one that was measured - the focused build names a
// node window from the sequence and only those nodes get freshness, while boundedEvalNeighbors picks the rows
// independently. If a pick ever falls outside the window its state is looked up and missing, and the page
// quietly shows 'empty' for a real verdict. The split is asymmetric at the ends (the forward side takes the
// odd slot, a boundary refills from the other side), so the ends are exactly where a hand-checked index lies.
test('the focus window contains every neighbour the projection can choose, at every position', () => {
  const order = Array.from({ length: 41 }, (_, i) => ({
    node: `n${i % 7}`,
    scenario: `s${String(i).padStart(2, '0')}`,
    ts: `2026-02-${String(41 - i).padStart(2, '0')}T00:00:00Z`,
  }))
  const sequence = measuredSequence(order)
  assert.equal(sequence.length, 41, 'every row here is measured, so the sequence is the whole set')
  for (let i = 0; i < sequence.length; i++) {
    const { node, scenario } = sequence[i]
    const focus = new Set(focusNodes(order, node, scenario))
    assert.ok(focus.has(node), `index ${i}: the selected row's own node must be measured`)
    const neighbours = boundedEvalNeighbors(sequence, node, scenario, () => 'pass')
    assert.equal(neighbours.index, i, `index ${i}: the projection and the window must agree on position`)
    assert.equal(neighbours.total, 41)
    for (const row of [...neighbours.prev, ...neighbours.next])
      assert.ok(focus.has(row.node),
        `index ${i}: neighbour ${row.node}/${row.scenario} falls OUTSIDE the focus window — its verdict would read empty`)
  }
})

// a scenario absent from the sequence (never filed) still has to resolve to something measurable
test('an unmeasured selection still focuses its own node', () => {
  const order = [{ node: 'a', scenario: 'filed', ts: '2026-01-01T00:00:00Z' }, { node: 'b', scenario: 'blind', ts: null }]
  assert.deepEqual(focusNodes(order, 'b', 'blind'), ['b'], 'a blind row is not in the measured sequence, so it focuses itself')
  assert.deepEqual(measuredSequence(order), [{ node: 'a', scenario: 'filed' }], 'and blind rows never enter the sequence')
})
