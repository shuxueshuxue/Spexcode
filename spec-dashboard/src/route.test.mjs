import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, routeHash, legacyEvalHash, queryString } from './route.js'
import { addressHash, sessionEvalAddress } from './address.js'

// The URL layer's two axes ([[side-nav]]): the PATH names the object, the QUERY carries view state —
// and the legacy session-eval address normalizes to the evals family at the parse layer.

test('parseRoute splits path and query inside the hash', () => {
  assert.deepEqual(parseRoute('#/evals'), { page: 'evals', param: null, query: {} })
  assert.deepEqual(parseRoute('#/evals?kind=all&session=abc'), { page: 'evals', param: null, query: { kind: 'all', session: 'abc' } })
  assert.deepEqual(parseRoute('#/evals/my-node/my%20scenario?session=abc'),
    { page: 'evals', param: 'my-node/my scenario', query: { session: 'abc' } })
  assert.deepEqual(parseRoute('#/issues/th-123?store=github&concluded=1'),
    { page: 'issues', param: 'th-123', query: { store: 'github', concluded: '1' } })
  assert.deepEqual(parseRoute('#/sessions/abc'), { page: 'sessions', param: 'abc', query: {} })
  assert.deepEqual(parseRoute('#/nope'), { page: 'graph', param: null, query: {} })
})

test('routeHash round-trips through parseRoute, query in canonical key order', () => {
  const h = routeHash('evals', 'node-a/scenario b', { session: 's1', kind: 'all' })
  assert.equal(h, '#/evals/node-a/scenario%20b?kind=all&session=s1')
  assert.deepEqual(parseRoute(h), { page: 'evals', param: 'node-a/scenario b', query: { kind: 'all', session: 's1' } })
  // the same state always prints the same address, whatever the object key order
  assert.equal(queryString({ session: 's1', kind: 'all' }), queryString({ kind: 'all', session: 's1' }))
  // empty/null values drop out
  assert.equal(routeHash('issues', null, { store: null, live: '' }), '#/issues')
})

test('legacy #/sessions/<id>/eval normalizes to the evals family (replace source, never re-minted)', () => {
  assert.equal(legacyEvalHash('#/sessions/abc/eval'), '#/evals?session=abc')
  assert.equal(legacyEvalHash('#/sessions/abc/eval/my-node/my-scenario'),
    '#/evals/my-node/my-scenario?session=abc')
  // a scenario name with slashes survives — the detail page splits on the FIRST '/'
  assert.equal(legacyEvalHash('#/sessions/abc/eval/n/a/b'), '#/evals/n/a/b?session=abc')
  // non-legacy shapes pass through untouched
  assert.equal(legacyEvalHash('#/sessions/abc'), null)
  assert.equal(legacyEvalHash('#/evals/n/s'), null)
  assert.equal(legacyEvalHash('#/graph'), null)
})

test('the normalized legacy detail address re-parses to the same (node, scenario, session)', () => {
  const canon = legacyEvalHash('#/sessions/s-1/eval/side-nav/rail-order')
  const r = parseRoute(canon)
  assert.equal(r.page, 'evals')
  assert.equal(r.param, 'side-nav/rail-order')
  assert.equal(r.query.session, 's-1')
})

test('legacy and object session-eval addresses converge on the canonical evals hash', () => {
  const canonical = '#/evals/shell-layout/tab%20switch?session=abc'
  assert.equal(legacyEvalHash('#/sessions/abc/eval/shell-layout/tab%20switch'), canonical)
  assert.equal(addressHash(sessionEvalAddress('abc', 'shell-layout', 'tab switch')), canonical)
  assert.equal(addressHash(sessionEvalAddress('abc', null, null)), '#/evals?session=abc')
})
