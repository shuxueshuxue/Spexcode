import test from 'node:test'
import assert from 'node:assert/strict'
import { invalidReviewPageHash, parseRoute, routeHash, legacyReviewHash, queryString, sessionSurfaceHash } from './route.js'
import { addressHash, addressUrl, graphNodeAddress, routeAddress, sessionSurfaceAddress, specAddress } from './address.js'

// The URL layer's two axes ([[side-nav]]): the PATH names the object, the QUERY carries view state — one
// ?q=<raw token text> for the review lists ([[review-query]]) and legacy structured filter params normalize
// to the canonical form at the parse layer.

test('parseRoute splits path and query inside the hash', () => {
  assert.deepEqual(parseRoute('#/graph/node-a'), { page: 'graph', param: 'node-a', query: {} })
  assert.deepEqual(parseRoute('#/sessions/abc'), { page: 'sessions', param: 'abc', query: {} })
  assert.deepEqual(parseRoute('#/sessions/abc?surface=terminal'), { page: 'sessions', param: 'abc', query: { surface: 'terminal' } })
  // an unknown address and a cold hash land on the sessions face, with no selector.
  assert.deepEqual(parseRoute('#/nope'), { page: 'sessions', param: null, query: {} })
  assert.deepEqual(parseRoute('#/nope/abc'), { page: 'sessions', param: null, query: {} })
  assert.deepEqual(parseRoute(''), { page: 'sessions', param: null, query: {} })
})

test('session conversation face stays on the session object address', () => {
  assert.equal(sessionSurfaceHash('#/sessions/abc?surface=conversation'), null)
  assert.equal(addressHash(sessionSurfaceAddress('abc', 'conversation')), '#/sessions/abc?surface=conversation')
})

test('resource faces stay on the session object address and round-trip as a normal tab identity', () => {
  const address = sessionSurfaceAddress('abc', 'resource:abc:web:preview')
  assert.equal(addressHash(address), '#/sessions/abc?surface=resource%3Aabc%3Aweb%3Apreview')
  assert.deepEqual(parseRoute(addressHash(address)), {
    page: 'sessions', param: 'abc', query: { surface: 'resource:abc:web:preview' },
  })
  assert.equal(sessionSurfaceHash(addressHash(address)), null)
})

test('parseRoute keeps the explicit empty workspace address and carries no selector', () => {
  assert.deepEqual(parseRoute('#/empty'), { page: 'empty', param: null, query: {} })
  assert.deepEqual(parseRoute('#/empty/anything'), { page: 'empty', param: null, query: {} })
  assert.equal(routeHash('empty'), '#/empty')
})

test('routeHash round-trips through parseRoute, q leading and the rest sorted', () => {
  const h = routeHash('issues', 'node-a', { q: 'state:closed' })
  assert.equal(h, '#/issues/node-a?q=state%3Aclosed')
  assert.deepEqual(parseRoute(h), { page: 'issues', param: 'node-a', query: { q: 'state:closed' } })
  // the same state always prints the same address, whatever the object key order
  assert.equal(queryString({ session: 's1', kind: 'all' }), queryString({ kind: 'all', session: 's1' }))
  assert.equal(
    queryString({ session: 's1', q: 'long title', freshness: 'stale' }),
    '?q=long%20title&freshness=stale&session=s1',
  )
  // empty/null values drop out
  assert.equal(routeHash('issues', null, { q: null, store: '' }), '#/issues')
})

test('legacy structured review params replay into the one ?q token text', () => {
  assert.equal(legacyReviewHash('#/issues?state=closed&author=w-1'),
    '#/issues?q=is%3Aissue%20state%3Aclosed%20author%3Aw-1')
  assert.equal(legacyReviewHash('#/issues?concluded=1'), '#/issues?q=is%3Aissue%20state%3Aclosed')
  assert.equal(legacyReviewHash('#/issues?live=1'), '#/issues?q=is%3Aissue%20state%3Aopen%20session%3Apresent')
  // the old free-text q rides along as ONE quoted phrase
  assert.equal(legacyReviewHash('#/issues?store=github&q=long+title'),
    '#/issues?q=is%3Aissue%20state%3Aopen%20store%3Agithub%20%22long%20title%22')
  // a legacy state equal to the default collapses to the BARE canonical address
  assert.equal(legacyReviewHash('#/issues?state=open'), '#/issues')
  // canonical addresses are already home — no rewrite
  assert.equal(legacyReviewHash('#/issues?q=frobnicate%3Axyz'), null)
  assert.equal(legacyReviewHash('#/graph'), null)
})

test('graph node addresses carry the focused node in the graph path', () => {
  assert.equal(addressHash(graphNodeAddress('keyboard-nav')), '#/graph/keyboard-nav')
  assert.equal(addressHash(graphNodeAddress('node with space')), '#/graph/node%20with%20space')
  assert.equal(addressUrl(graphNodeAddress('keyboard-nav'), 'https://example.test/p/spexcode/'),
    'https://example.test/p/spexcode/#/graph/keyboard-nav')
})

test('spec addresses carry the document node in the spec path', () => {
  assert.equal(addressHash(specAddress('tab-strip')), '#/spec/tab-strip')
  assert.equal(addressHash(specAddress('node with space')), '#/spec/node%20with%20space')
})

test('routeAddress is a pure bridge from shared address vocabulary to ViewScope input', () => {
  assert.deepEqual(routeAddress(sessionSurfaceAddress('abc', 'terminal')), {
    page: 'sessions', param: 'abc', query: { surface: 'terminal' },
  })
})

test('detailBackHash returns to the issue list on its own data-source axis', async () => {
  const { detailBackHash } = await import('./address.js')
  // an issue detail returns to the issues list
  assert.equal(detailBackHash('issues'), '#/issues')
  // deterministic: same page+scope → same href, no history/referrer input exists in the signature
  assert.equal(detailBackHash('issues', 'abc'), detailBackHash('issues', 'abc'))
})

test('review page state keeps GitHub page-1 action history and repairs only invalid values', () => {
  assert.equal(routeHash('issues', null, { q: 'is:issue state:open', page: '2' }),
    '#/issues?q=is%3Aissue%20state%3Aopen&page=2')
  assert.equal(routeHash('issues', null, { page: '1' }), '#/issues?page=1')
  assert.deepEqual(parseRoute('#/issues?page=1').query, { page: '1' })
  assert.equal(invalidReviewPageHash('#/issues?page=1'), null)
  assert.equal(invalidReviewPageHash('#/issues?page=999999'), null)
  assert.equal(invalidReviewPageHash('#/issues?page=0'), '#/issues')
})
