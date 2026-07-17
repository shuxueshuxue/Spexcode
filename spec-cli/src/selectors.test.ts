import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSession, matchesSelector, selectSessions, type Session } from './sessions.js'

// minimal Session builder — only id/node/branch feed the selector matcher; the rest are inert defaults so the
// resolver sees realistic rows without dragging in tmux/git state.
function mk(id: string, node: string | null, branch: string | null): Session {
  return {
    id, node, branch, label: node || branch || id, headline: node || branch || id, raw: { name: null, title: null }, path: `/wt/${id}`, parent: null, harness: 'claude', launcher: null, mode: 'interactive',
    lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online', note: null,
    prompt: null, promptPreview: null, created: 0, activity: null, sortKey: null,
  }
}

const a = mk('aaaa1111-1111-1111-1111-111111111111', 'sessions', 'node/sessions-aaaa')
const b = mk('aaaa2222-2222-2222-2222-222222222222', 'graph', 'node/graph-bbbb')
const c = mk('bbbb3333-3333-3333-3333-333333333333', 'launch', 'node/launch-cccc')
const board = [a, b, c]

// ---- resolveSession: the single-target lookup the control verbs use ----

test('resolveSession: a full id is an exact, unambiguous hit', () => {
  assert.deepEqual(resolveSession(a.id, board), { ok: a })
})

test('resolveSession: a unique id-prefix resolves', () => {
  assert.deepEqual(resolveSession('bbbb3333', board), { ok: c })
})

test('resolveSession: a node selector resolves', () => {
  assert.deepEqual(resolveSession('graph', board), { ok: b })
})

test('resolveSession: a branch selector resolves', () => {
  assert.deepEqual(resolveSession('node/launch-cccc', board), { ok: c })
})

test('resolveSession: a prefix matching several is ambiguous (carries the candidates)', () => {
  const r = resolveSession('aaaa', board)
  assert.ok('ambiguous' in r)
  assert.deepEqual((r as { ambiguous: Session[] }).ambiguous, [a, b])
})

test('resolveSession: an exact full id wins even when it also prefixes a longer id', () => {
  const x = mk('dead', 'x', 'node/x')          // full id 'dead'
  const y = mk('deadbeef', 'y', 'node/y')      // 'dead' is a PREFIX of this id
  assert.deepEqual(resolveSession('dead', [x, y]), { ok: x })   // exact wins, not ambiguous
})

test('resolveSession: no match is none', () => {
  assert.deepEqual(resolveSession('nope', board), { none: true })
})

// ---- matchesSelector: the one shared predicate ----

test('matchesSelector: matches id, id-prefix, node, branch — and only those', () => {
  assert.ok(matchesSelector(a, a.id))
  assert.ok(matchesSelector(a, 'aaaa1111'))
  assert.ok(matchesSelector(a, 'sessions'))
  assert.ok(matchesSelector(a, 'node/sessions-aaaa'))
  assert.ok(!matchesSelector(a, 'graph'))
})

test('matchesSelector: a comma list matches iff ANY part names the session', () => {
  // the bug this guards: `watch a,b` was one literal selector that matched nothing (an id/node/branch never
  // holds a comma) → a comma-joined watch streamed zero events in silence. Comma now ORs the parts.
  assert.ok(matchesSelector(a, 'sessions,graph'))      // first part hits
  assert.ok(matchesSelector(b, 'sessions,graph'))      // second part hits
  assert.ok(matchesSelector(c, 'bbbb3333,nope'))       // id-prefix part hits
  assert.ok(!matchesSelector(c, 'sessions,graph'))     // neither part names c
  assert.ok(matchesSelector(a, 'sessions, graph'))     // whitespace around a part is trimmed
})

test('selectSessions: a single comma-joined selector selects the union (watch a,b == watch a b)', () => {
  const comma = selectSessions(board, ['sessions,graph']).map((s) => s.id)
  const space = selectSessions(board, ['sessions', 'graph']).map((s) => s.id)
  assert.deepEqual(comma, [a.id, b.id])
  assert.deepEqual(comma, space)
})

// ---- the invariant: list-filter and single-resolve never diverge ----

test('selectSessions and resolveSession agree on the shared predicate', () => {
  // any selector that narrows the list to exactly one row must resolve to that same row
  for (const q of ['graph', 'bbbb3333', 'node/launch-cccc']) {
    const filtered = selectSessions(board, [q])
    assert.equal(filtered.length, 1)
    assert.deepEqual(resolveSession(q, board), { ok: filtered[0] })
  }
})

// ---- sigil tolerance: a CLI selector sheds an optional @ / [[ ]] (see [[mentions]]) ----

test('matchesSelector: @sel and [[sel]] name the same session as the bare token', () => {
  assert.ok(matchesSelector(a, '@sessions'))
  assert.ok(matchesSelector(a, '[[sessions]]'))
  assert.ok(matchesSelector(a, '@aaaa1111'))            // sigil + id-prefix
  assert.ok(matchesSelector(a, '@sessions,@graph'))     // per-part in a comma list
  assert.ok(!matchesSelector(c, '@sessions'))           // tolerance never widens what matches
})

test('resolveSession: a sigiled selector resolves like the bare one; @full-id keeps exact-wins', () => {
  assert.deepEqual(resolveSession('@graph', board), { ok: b })
  assert.deepEqual(resolveSession('[[graph]]', board), { ok: b })
  const x = mk('dead', 'x', 'node/x')
  const y = mk('deadbeef', 'y', 'node/y')
  assert.deepEqual(resolveSession('@dead', [x, y]), { ok: x })   // exact full-id wins through the sigil
})
