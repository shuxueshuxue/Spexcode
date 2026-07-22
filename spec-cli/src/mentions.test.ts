import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseMentions, resolveActors, spawnParent, newWorkerPrompt, summarize, deliveredIds, notifyOriginator, pickLoopIn, stripRefSigil, type ActorSession } from './mentions.js'

// ---- parseMentions: the pure grammar ----

test('parseMentions: actors at word boundaries, qualified @new, and nodes in [[]] are deduped first-seen', () => {
  const { actors, nodes } = parseMentions('hey @abc look at [[sessions]] and @new — @new:codex @abc again, also [[graph]] [[sessions]] @new:codex')
  assert.deepEqual(actors, ['abc', 'new', 'new:codex'])
  assert.deepEqual(nodes, ['sessions', 'graph'])
})

test('parseMentions: a mid-word @ is not an actor', () => {
  assert.deepEqual(parseMentions('mail me at user@example.com').actors, [])
})

// ---- resolveActors: online-only matching ----

const on = (id: string, name: string | null): ActorSession => ({ id, node: null, name, title: null, liveness: 'online' })
const off = (id: string, name: string | null): ActorSession => ({ id, node: null, name, title: null, liveness: 'offline' })

test('resolveActors: new → sentinel; online id-prefix → session; offline-only → unresolved', () => {
  const sessions = [on('abcd1234', 'scout'), off('ffff9999', 'ghost')]
  const [n, hit, dead, nobody] = resolveActors(['new', 'abcd', 'ghost', 'zzz'], sessions)
  assert.equal(n.kind, 'new')
  assert.equal(hit.kind, 'session')
  assert.equal((hit as { session: ActorSession }).session.id, 'abcd1234')
  assert.equal(dead.kind, 'unresolved')   // a dead session is never summoned
  assert.equal(nobody.kind, 'unresolved')
})

test('resolveActors: launcher-qualified new carries the explicit launcher', () => {
  const [fresh] = resolveActors(['new:claude-glm'], [])
  assert.deepEqual(fresh, { token: 'new:claude-glm', kind: 'new', launcher: 'claude-glm' })
})

// ---- spawnParent: any spawn's parent = its originator, session ids only ----

test('spawnParent: an author that IS a board session id becomes the parent (exact id, any liveness)', () => {
  const sessions = [on('abcd1234', 'scout'), off('ffff9999', 'ghost')]
  assert.equal(spawnParent('abcd1234', sessions), 'abcd1234')
  assert.equal(spawnParent('ffff9999', sessions), 'ffff9999')   // offline spawner still owns its lineage
})

test('spawnParent: human / unknown / forge-login / id-prefix authors are no parent — top-level, never a phantom nest', () => {
  const sessions = [on('abcd1234', 'scout')]
  for (const author of ['human', 'unknown', 'shuxueshuxue', 'abcd']) assert.equal(spawnParent(author, sessions), null)
})

// ---- the drain guard: @new on a settled thread ----

test('newWorkerPrompt: an open (or unknown) thread carries no status note', () => {
  for (const status of ['open', undefined, null]) {
    const p = newWorkerPrompt('t-1', 'mentions', 'me', 'take a look @new', status)
    assert.ok(!p.includes('already resolved'), `status=${status} must not warn`)
    assert.deepEqual(parseMentions(p).nodes, ['mentions'], 'the inherited node is visible as the first prompt mention')
  }
})

test('newWorkerPrompt: a settled thread leads the worker to verify main before re-implementing', () => {
  const p = newWorkerPrompt('t-1', 'mentions', 'me', 'take a look @new', 'landed')
  assert.ok(p.includes('already resolved (status: landed)'))
  assert.ok(p.includes('Verify the current state on main FIRST'))
  assert.ok(p.includes('instead of re-implementing'))
})

test('summarize: a spawn onto a settled thread warns in the outcome line', () => {
  const s = summarize([{ token: 'new', result: 'spawned', detail: 'abcd1234', note: 'thread landed' }])
  assert.ok(s.includes('new→abcd1234 ⚠ thread landed'))
  assert.equal(summarize([{ token: 'new', result: 'spawned', detail: 'abcd1234' }]), '@ new→abcd1234')
})

test('summarize: a qualified spawn keeps the selected launcher visible', () => {
  assert.equal(summarize([{ token: 'new:codex', result: 'spawned', detail: 'abcd1234' }]), '@ new:codex→abcd1234')
})

// ---- implicit originator loop-in ----

test('deliveredIds: only sent/spawned session ids (offline/unresolved carry none)', () => {
  const ids = deliveredIds([
    { token: 'a', result: 'sent', detail: 'sess-a' },
    { token: 'new', result: 'spawned', detail: 'sess-new' },
    { token: 'b', result: 'offline', detail: 'no socket' },   // detail is an error, not a session id
    { token: 'c', result: 'unresolved' },
  ])
  assert.deepEqual([...ids].sort(), ['sess-a', 'sess-new'])
})

test('summarize: the loop-in is noted distinct from the @-dispatch, and shows even with no @', () => {
  assert.equal(summarize([{ token: 'a', result: 'sent', detail: 'sess-a' }], { originator: 'alice' }),
    '@ a→sent  ·  ↩ looped in originator @alice (online)')
  assert.equal(summarize([], { originator: 'alice' }), '↩ looped in originator @alice (online)')
  assert.equal(summarize([]), '')
})

// ---- the dispatch fallback chain (R3): filer → node's governing session → nobody ----

test('pickLoopIn: the reading filer online → delivered to the filer (the first link)', () => {
  const sessions = [on('filer1', null), on('gov1', null)]
  const pick = pickLoopIn(['filer1', 'gov1'], 'replier', sessions)
  assert.equal(pick.kind, 'deliver')
  assert.equal((pick as { originator: string }).originator, 'filer1')
})

test('pickLoopIn: filer OFFLINE → falls through to the node governing session', () => {
  const sessions = [off('filer1', null), on('gov1', null)]
  const pick = pickLoopIn(['filer1', 'gov1'], 'replier', sessions)
  assert.equal(pick.kind, 'deliver')
  assert.equal((pick as { originator: string }).originator, 'gov1')   // the fallback link reached
})

test('pickLoopIn: whole chain offline/absent → nobody (silent; the teeth still surface it)', () => {
  const sessions = [off('filer1', null), off('gov1', null)]
  assert.equal(pickLoopIn(['filer1', 'gov1'], 'replier', sessions).kind, 'none')
  assert.equal(pickLoopIn([null, 'ghost'], 'replier', sessions).kind, 'none')   // a link that resolves to no session
})

test('pickLoopIn: a link already reached by an explicit @-target → stop, no double-delivery', () => {
  const sessions = [on('filer1', null), on('gov1', null)]
  const pick = pickLoopIn(['filer1', 'gov1'], 'replier', sessions, new Set(['filer1']))
  assert.equal(pick.kind, 'reached')   // filer got it via @ already → the chain stops, no courtesy to gov1
})

test('pickLoopIn: the filer being the replier is pruned → the governing session is reached', () => {
  const sessions = [on('me', null), on('gov1', null)]
  const pick = pickLoopIn(['me', 'gov1'], 'me', sessions)   // filer == replier (no self-notify)
  assert.equal(pick.kind, 'deliver')
  assert.equal((pick as { originator: string }).originator, 'gov1')
})

test('notifyOriginator: an empty fallback chain (nulls, or only the replier) → no delivery (no session load)', async () => {
  // returns before importing sessions.js — a self-reply or an authorless thread loops in nobody, and a chain
  // that prunes down to nothing (every link null or the replier) short-circuits the same way.
  assert.equal(await notifyOriginator([null], 'alice', 'hi', { threadId: 't1', node: null }), null)
  assert.equal(await notifyOriginator(['alice'], 'alice', 'hi', { threadId: 't1', node: null }), null)
  assert.equal(await notifyOriginator(['alice', null, 'alice'], 'alice', 'hi', { threadId: 't1', node: null }), null)
})

// ---- stripRefSigil: CLI args tolerate the reference sigils ----

test('stripRefSigil: sheds a leading @ or a [[ ]] wrapper; bare tokens pass through', () => {
  assert.equal(stripRefSigil('@graph'), 'graph')
  assert.equal(stripRefSigil('[[cli-surface]]'), 'cli-surface')
  assert.equal(stripRefSigil('cli-surface'), 'cli-surface')
  assert.equal(stripRefSigil('node/graph-abcd'), 'node/graph-abcd')   // a branch selector is untouched
})

test('stripRefSigil: only a FULL wrapper counts; a lone @ strips to empty (→ treated as missing)', () => {
  assert.equal(stripRefSigil('[[x]]y'), '[[x]]y')   // not a pure wrapper — left alone
  assert.equal(stripRefSigil('@'), '')
})
