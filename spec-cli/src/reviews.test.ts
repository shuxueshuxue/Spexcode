import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedEvalNeighbors, paginateReview, projectEvalDetail, reviewPageNumber, scopedEvalReviewItems, trunkEvalReviewItems } from './reviews.js'

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
  assert.equal(a.revision, b.revision)
  assert.notEqual(a.revision, c.revision)
  assert.equal(reviewPageNumber('0'), 1)
  assert.equal(reviewPageNumber('999999'), 999999)
})

test('trunk and scoped eval sources produce one tagged stable item vocabulary', () => {
  const reading = (scenario: string, ts: string, inSession = false) => ({
    scenario, ts, fresh: true, verdict: { status: 'pass' }, inSession,
  })
  const trunk = trunkEvalReviewItems([{ id: 'n', hue: 10, scenarios: [{ name: 'a' }], evals: [reading('a', '2026-01-01')] }])
  assert.deepEqual(trunk.map((item) => [item.node, item.scenario, item.filterKind, item.state]), [['n', 'a', 'result', 'pass']])

  const scoped = scopedEvalReviewItems({
    id: 's', node: 'n', branch: 'node/n', title: 'n', ahead: 1, dirtyNonRuntime: 0, gates: [],
    summary: { measured: 1, total: 2, pass: 1, fail: 0, review: 0, blind: 1, unknown: 0 },
    evalRevision: { epoch: 'test', generation: 1, content: 'fixture' },
    nodes: [{
      id: 'n', title: 'n', hue: 10, desc: '', hasEvalFile: true, uncoveredFrontend: false,
      unknownCoverage: [], scenarios: [{ name: 'blind', expected: '', impact: ['code'] }, { name: 'own', expected: '', impact: ['code'] }],
      evals: [reading('own', '2026-01-02', true) as any],
    }],
  })
  assert.deepEqual(scoped.map((item) => [item.scenario, item.filterKind]), [['blind', 'blind'], ['own', 'result']])
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
  assert.equal(detail.revision, projectEvalDetail(items, history, 'n', 's4').revision)
  assert.notEqual(detail.revision, projectEvalDetail(items, history.slice(0, 1), 'n', 's4').revision)
  const scoped = { scope: 's', summary: { measured: 9, total: 9, pass: 5, fail: 4, review: 0, blind: 0, unknown: 0 } }
  const changedSummary = { scope: 's', summary: { ...scoped.summary, unknown: 1 } }
  assert.notEqual(projectEvalDetail(items, history, 'n', 's4', scoped).revision, projectEvalDetail(items, history, 'n', 's4', changedSummary).revision)
})

test('detail neighbor budget refills at boundaries and missing selections stay honest', () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ node: 'n', scenario: `s${index}`, state: 'pass', filterKind: 'result' }))
  assert.deepEqual(boundedEvalNeighbors(items, 'n', 's0').next.map((row) => row.scenario), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(boundedEvalNeighbors(items, 'n', 's7').prev.map((row) => row.scenario), ['s6', 's5', 's4', 's3', 's2'])
  const missing = projectEvalDetail(items, [{ scenario: 'absent' }], 'n', 'absent', {
    scope: 'scope-1',
    summary: { measured: 8, total: 8, pass: 8, fail: 0, review: 0, blind: 0, unknown: 0 },
    evalRevision: { epoch: 'epoch', generation: 3, content: 'content' },
  })
  assert.equal(missing.selected, null)
  assert.equal(missing.neighbors.index, null)
  assert.equal(missing.neighbors.total, 8)
  assert.deepEqual(missing.evalRevision, { epoch: 'epoch', generation: 3, content: 'content' })
  assert.equal(missing.summary?.total, 8)
})
