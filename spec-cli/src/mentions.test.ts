import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseMentions, notifyOriginator, pickLoopIn, stripRefSigil, summarizeLoopIn } from './mentions.js'

// ---- parseMentions: the pure grammar ----

test('parseMentions: session references and nodes are deduped first-seen', () => {
  const { sessions, nodes } = parseMentions('hey @abc look at [[sessions]] and @old:handoff @abc again, also [[graph]] [[sessions]] @old:handoff')
  assert.deepEqual(sessions, ['abc', 'old:handoff'])
  assert.deepEqual(nodes, ['sessions', 'graph'])
})

test('parseMentions: a mid-word @ is not a session reference', () => {
  assert.deepEqual(parseMentions('mail me at user@example.com').sessions, [])
})

// ---- implicit originator loop-in ----

const on = (id: string, name: string | null) => ({ id, node: null, name, title: null, liveness: 'online' })
const off = (id: string, name: string | null) => ({ id, node: null, name, title: null, liveness: 'offline' })

test('summarizeLoopIn: courtesy is distinct from @ references', () => {
  assert.equal(summarizeLoopIn({ originator: 'alice' }), 'looped in originator @alice (online)')
  assert.equal(summarizeLoopIn(), '')
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
