import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseMentions, resolveActors, newWorkerPrompt, summarize, type ActorSession } from './mentions.js'

// ---- parseMentions: the pure grammar ----

test('parseMentions: actors at word boundaries, nodes in [[]], each deduped first-seen', () => {
  const { actors, nodes } = parseMentions('hey @abc look at [[sessions]] and @new — @abc again, also [[graph]] [[sessions]]')
  assert.deepEqual(actors, ['abc', 'new'])
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

// ---- the drain guard: @new on a settled thread ----

test('newWorkerPrompt: an open (or unknown) thread carries no status note', () => {
  for (const status of ['open', undefined, null]) {
    const p = newWorkerPrompt('t-1', 'mentions', 'me', 'take a look @new', status)
    assert.ok(!p.includes('already resolved'), `status=${status} must not warn`)
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
