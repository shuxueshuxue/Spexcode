import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, routeHash, legacyEvalHash, legacyReviewHash, queryString } from './route.js'
import { addressHash, sessionEvalAddress } from './address.js'

// The URL layer's two axes ([[side-nav]]): the PATH names the object, the QUERY carries view state — one
// ?q=<raw token text> for the review lists ([[review-query]]) — and every legacy shape (session-eval
// path, structured filter params) normalizes to the canonical form at the parse layer.

test('parseRoute splits path and query inside the hash', () => {
  assert.deepEqual(parseRoute('#/evals'), { page: 'evals', param: null, query: {} })
  assert.deepEqual(parseRoute('#/evals?q=is%3Aeval+state%3Areviewed'), { page: 'evals', param: null, query: { q: 'is:eval state:reviewed' } })
  assert.deepEqual(parseRoute('#/evals/my-node/my%20scenario?q=scope%3Aabc'),
    { page: 'evals', param: 'my-node/my scenario', query: { q: 'scope:abc' } })
  assert.deepEqual(parseRoute('#/sessions/abc'), { page: 'sessions', param: 'abc', query: {} })
  assert.deepEqual(parseRoute('#/nope'), { page: 'graph', param: null, query: {} })
})

test('routeHash round-trips through parseRoute, q leading and the rest sorted', () => {
  const h = routeHash('evals', 'node-a/scenario b', { q: 'state:reviewed' })
  assert.equal(h, '#/evals/node-a/scenario%20b?q=state%3Areviewed')
  assert.deepEqual(parseRoute(h), { page: 'evals', param: 'node-a/scenario b', query: { q: 'state:reviewed' } })
  // the same state always prints the same address, whatever the object key order
  assert.equal(queryString({ session: 's1', kind: 'all' }), queryString({ kind: 'all', session: 's1' }))
  assert.equal(
    queryString({ session: 's1', q: 'long title', freshness: 'stale' }),
    '?q=long+title&freshness=stale&session=s1',
  )
  // empty/null values drop out
  assert.equal(routeHash('issues', null, { q: null, store: '' }), '#/issues')
})

test('legacy #/sessions/<id>/eval normalizes to the evals family (replace source, never re-minted)', () => {
  // the LIST door lands on the scoped DEFAULT view — the visible text says exactly that
  assert.equal(legacyEvalHash('#/sessions/abc/eval'), '#/evals?q=is%3Aeval+state%3Acurrent+scope%3Aabc')
  // a DETAIL address carries only the scope token, never list filters
  assert.equal(legacyEvalHash('#/sessions/abc/eval/my-node/my-scenario'),
    '#/evals/my-node/my-scenario?q=scope%3Aabc')
  // a scenario name with slashes survives — the detail page splits on the FIRST '/'
  assert.equal(legacyEvalHash('#/sessions/abc/eval/n/a/b'), '#/evals/n/a/b?q=scope%3Aabc')
  // non-legacy shapes pass through untouched
  assert.equal(legacyEvalHash('#/sessions/abc'), null)
  assert.equal(legacyEvalHash('#/evals/n/s'), null)
  assert.equal(legacyEvalHash('#/graph'), null)
})

test('legacy structured review params replay into the one ?q token text', () => {
  assert.equal(legacyReviewHash('#/issues?state=closed&author=w-1'),
    '#/issues?q=is%3Aissue+state%3Aclosed+author%3Aw-1')
  assert.equal(legacyReviewHash('#/issues?concluded=1'), '#/issues?q=is%3Aissue+state%3Aclosed')
  assert.equal(legacyReviewHash('#/issues?live=1'), '#/issues?q=is%3Aissue+state%3Aopen+session%3Apresent')
  assert.equal(legacyReviewHash('#/evals?ok=1'), '#/evals?q=is%3Aeval+state%3Areviewed')
  assert.equal(legacyReviewHash('#/evals?session=s-9&verdict=fail'),
    '#/evals?q=is%3Aeval+state%3Acurrent+verdict%3Afail+scope%3As-9')
  // the old free-text q rides along as ONE quoted phrase
  assert.equal(legacyReviewHash('#/issues?store=github&q=long+title'),
    '#/issues?q=is%3Aissue+state%3Aopen+store%3Agithub+%22long+title%22')
  // a legacy state equal to the default collapses to the BARE canonical address
  assert.equal(legacyReviewHash('#/issues?state=open'), '#/issues')
  assert.equal(legacyReviewHash('#/evals?kind=all'), '#/evals')
  // a legacy DETAIL address keeps only its worktree scope
  assert.equal(legacyReviewHash('#/evals/n/s?session=abc'), '#/evals/n/s?q=scope%3Aabc')
  assert.equal(legacyReviewHash('#/evals/n/s?kind=video'), '#/evals/n/s')
  // canonical addresses are already home — no rewrite
  assert.equal(legacyReviewHash('#/evals'), null)
  assert.equal(legacyReviewHash('#/evals?q=verdict%3Afail'), null)
  assert.equal(legacyReviewHash('#/issues?q=frobnicate%3Axyz'), null)
  assert.equal(legacyReviewHash('#/graph'), null)
})

test('the normalized legacy detail address re-parses to the same (node, scenario, scope)', () => {
  const canon = legacyEvalHash('#/sessions/s-1/eval/side-nav/rail-order')
  const r = parseRoute(canon)
  assert.equal(r.page, 'evals')
  assert.equal(r.param, 'side-nav/rail-order')
  assert.equal(r.query.q, 'scope:s-1')
})

test('legacy and object session-eval addresses converge on the canonical evals hash', () => {
  const canonical = '#/evals/shell-layout/tab%20switch?q=scope%3Aabc'
  assert.equal(legacyEvalHash('#/sessions/abc/eval/shell-layout/tab%20switch'), canonical)
  assert.equal(addressHash(sessionEvalAddress('abc', 'shell-layout', 'tab switch')), canonical)
  assert.equal(addressHash(sessionEvalAddress('abc', null, null)), '#/evals?q=is%3Aeval+state%3Acurrent+scope%3Aabc')
})
