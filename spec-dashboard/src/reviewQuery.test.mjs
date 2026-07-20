import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, effectiveTokens, hasLegacyParams,
  legacyQueryText, normalizeQuery, queryParam, readToken, sameQuery, scanQuery, scopedEvalQuery,
  reviewRouteQuery, serialize, setToken, suggestAt, tokenize,
} from './reviewQuery.js'

// The ONE token-text engine ([[review-query]]): parse loses nothing, surgery preserves strangers,
// legacy params replay as the full visible state, and autocomplete stays bounded to page-supplied
// candidates. MATCHING lives in [[review-filters]] — its tests own the field semantics.

test('scan preserves every character and tokenize round-trips, quotes included', () => {
  const text = '  is:issue   state:open  "long title"  node:"a b"  frobnicate:xyz bare '
  assert.equal(scanQuery(text).map((seg) => seg.raw).join(''), text)
  for (const seg of scanQuery(text)) assert.equal(text.slice(seg.start, seg.end), seg.raw)

  const tokens = tokenize(text)
  assert.deepEqual(tokens.map((t) => [t.key, t.value]), [
    ['is', 'issue'], ['state', 'open'], [null, 'long title'], ['node', 'a b'],
    ['frobnicate', 'xyz'], [null, 'bare'],
  ])
  // serialize(tokenize()) is the canonical form; unknown tokens survive verbatim
  assert.equal(serialize(tokens), 'is:issue state:open "long title" node:"a b" frobnicate:xyz bare')
  assert.equal(normalizeQuery('  a   b '), 'a b')
  assert.ok(sameQuery(' is:issue  state:open', 'is:issue state:open '))
  assert.ok(!sameQuery('is:issue state:open', 'is:issue state:closed'))
})

test('token surgery rewrites in place, dedupes, appends, removes — strangers verbatim', () => {
  const text = 'state:open author:bpasero frobnicate:xyz boom'
  assert.equal(setToken(text, 'state', 'closed'), 'state:closed author:bpasero frobnicate:xyz boom')
  assert.equal(setToken(text, 'store', 'github'), 'state:open author:bpasero frobnicate:xyz boom store:github')
  assert.equal(setToken(text, 'author', ''), 'state:open frobnicate:xyz boom')
  assert.equal(setToken(text, 'author', null), 'state:open frobnicate:xyz boom')
  // duplicates collapse onto the FIRST position
  assert.equal(setToken('state:open x state:closed', 'state', 'reviewed'), 'state:reviewed x')
  // a value with spaces is quoted so it stays ONE token
  assert.equal(setToken('state:open', 'node', 'a b'), 'state:open node:"a b"')
  assert.equal(readToken(setToken('state:open', 'node', 'a b'), 'node'), 'a b')
})

test('duplicate qualifiers: last wins for every reader', () => {
  assert.equal(readToken('state:open state:closed', 'state'), 'closed')
  const eff = effectiveTokens(tokenize('state:open bare state:closed'))
  assert.deepEqual(eff.map((t) => t.raw), ['bare', 'state:closed'])
})

test('default equivalence: bare address for the default view, ?q verbatim otherwise', () => {
  assert.equal(queryParam('is:issue state:open', ISSUE_QUERY_DEFAULT), null)
  assert.equal(queryParam('  is:issue   state:open ', ISSUE_QUERY_DEFAULT), null)
  assert.equal(queryParam('', ISSUE_QUERY_DEFAULT), null)
  assert.equal(queryParam('   ', ISSUE_QUERY_DEFAULT), null)
  assert.deepEqual(queryParam('is:issue state:closed', ISSUE_QUERY_DEFAULT), { q: 'is:issue state:closed' })
  assert.equal(queryParam('is:eval', EVAL_QUERY_DEFAULT), null)
  assert.deepEqual(queryParam('is:eval verdict:fail', EVAL_QUERY_DEFAULT), { q: 'is:eval verdict:fail' })
  assert.equal(scopedEvalQuery('abc'), 'is:eval scope:abc')
  assert.equal(reviewRouteQuery(ISSUE_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT), null)
  assert.deepEqual(reviewRouteQuery(ISSUE_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, 1), { page: '1' })
  assert.deepEqual(reviewRouteQuery('is:issue state:closed', ISSUE_QUERY_DEFAULT, 2), { q: 'is:issue state:closed', page: '2' })
})

test('legacy structured params replay as the FULL visible token state', () => {
  assert.equal(hasLegacyParams({ q: 'plain' }), false)
  // the UNDECIDABLE boundary, decided by fiat ([[review-query]]): a bare ?q= with no structured param
  // is byte-identical in both grammars and ALWAYS reads as the new token grammar — an old bare
  // ?q=drift:check becomes an unknown-qualifier honest zero. No heuristic, no stored state.
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { q: 'plain' }), null)
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { q: 'drift:check' }), null)
  assert.equal(
    legacyQueryText(ISSUE_QUERY_DEFAULT, { state: 'closed', author: 'w-1' }),
    'is:issue state:closed author:w-1',
  )
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { concluded: '1' }), 'is:issue state:closed')
  assert.equal(legacyQueryText(EVAL_QUERY_DEFAULT, { ok: '1' }), 'is:eval state:reviewed')
  assert.equal(legacyQueryText(EVAL_QUERY_DEFAULT, { kind: 'video' }), 'is:eval evidence:video')
  // kind=all IS the default — replays to the plain default text
  assert.equal(legacyQueryText(EVAL_QUERY_DEFAULT, { kind: 'all' }), EVAL_QUERY_DEFAULT)
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { live: '1' }), 'is:issue state:open session:present')
  assert.equal(legacyQueryText(EVAL_QUERY_DEFAULT, { session: 's-9' }), 'is:eval scope:s-9')
  assert.equal(legacyQueryText(EVAL_QUERY_DEFAULT, { filer: 'w-2', freshness: 'stale', verdict: 'fail' }),
    'is:eval verdict:fail freshness:stale filer:w-2')
  // the free q survives — quoted as ONE phrase when it held spaces (the old single-substring search)
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { store: 'github', q: 'long title' }),
    'is:issue state:open store:github "long title"')
  // …and when it holds a colon or quote the tokenizer would misread: q=drift:check stays a substring
  // search, never an unknown-qualifier zero
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { live: '1', q: 'drift:check' }),
    'is:issue state:open session:present "drift:check"')
  assert.equal(legacyQueryText(ISSUE_QUERY_DEFAULT, { state: 'open', q: 'say "hi"' }),
    'is:issue state:open "say hi"')
})

test('autocomplete is bounded: keys complete in place, values only from supplied candidates', () => {
  const keys = ['is', 'state', 'store', 'author', 'node', 'session']
  const values = {
    author: [{ value: 'w-alpha' }, { value: 'w-beta' }, { value: 'human' }],
    scope: [{ value: 's-live-1', label: 'live one' }],
  }
  // bare prefix → key items, insert ends with ':'
  const atKeys = suggestAt('is:issue au', 11, keys, values)
  assert.deepEqual(atKeys.items.map((i) => i.insert), ['author:'])
  // key:prefix → value items from the candidate pool only, completing token + trailing space
  const atValues = suggestAt('is:issue author:w', 17, keys, values)
  assert.deepEqual(atValues.items.map((i) => i.insert), ['author:w-alpha ', 'author:w-beta '])
  assert.equal(atValues.start, 9)
  assert.equal(atValues.end, 17)
  // scope suggests ONLY what the page supplied (board sessions); labels ride along
  const atScope = suggestAt('scope:', 6, ['scope'], values)
  assert.deepEqual(atScope.items.map((i) => [i.insert, i.label]), [['scope:s-live-1 ', 'live one']])
  // an unknown qualifier gets NO suggestions — but stays typable
  assert.deepEqual(suggestAt('frobnicate:x', 12, keys, values).items, [])
  // no candidates → nothing, even for a known high-cardinality key
  assert.deepEqual(suggestAt('node:rev', 8, keys, values).items, [])
  // the pool is capped at 8
  const many = { node: Array.from({ length: 30 }, (_, i) => ({ value: `node-${i}` })) }
  assert.equal(suggestAt('node:', 5, keys, many).items.length, 8)
})
