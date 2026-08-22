#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrateJsonSessionRecords, openProjectSessionApplication } from '@spexcode/session-application'

const identity = (nativeSessionId, nativeStartToken) => ({
  namespace: 'spex-governed', runtimeKind: 'yatu', nativeSessionId, nativeStartToken,
})
const results = []
const scenario = (name, body) => {
  try { body(); results.push({ name, passed: true }) }
  catch (error) { results.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) }) }
}
const root = mkdtempSync(join(tmpdir(), 'session-production-cutover-yatu-'))
const db = name => join(root, `${name}.sqlite`)
const appFor = name => openProjectSessionApplication({ databasePath: db(name), locality: () => {} })

scenario('parent-child creation and topology', () => {
  const app = appFor('parent-child')
  app.createSession({ sessionId: 'parent', runtime: identity('p', '1') })
  app.createSession({ sessionId: 'child', parentSessionId: 'parent', runtime: identity('c', '1') })
  assert.equal(app.readState('child').parentSessionId, 'parent')
  assert.equal(app.topology.children('parent', 'parent')[0].toSessionId, 'child')
  app.close()
})

scenario('multiple watchers receive one ordered stream', () => {
  const app = appFor('watchers')
  app.createSession({ sessionId: 'subject' }); app.createSession({ sessionId: 'w1' }); app.createSession({ sessionId: 'w2' })
  app.attachWatcher('w1', 'subject'); app.attachWatcher('w2', 'subject')
  app.transitionSession('subject', { status: 'active' }); app.transitionSession('subject', { status: 'awaiting' })
  assert.deepEqual(app.protocol.listPending('w1').map(message => message.kind), ['session.state.changed.v1', 'session.state.changed.v1'])
  assert.deepEqual(app.protocol.listPending('w2').map(message => message.enqueueSeq), app.protocol.listPending('w1').map(message => message.enqueueSeq))
  app.close()
})

scenario('reparent updates the parent fact without duplicate edges', () => {
  const app = appFor('reparent')
  app.createSession({ sessionId: 'p1' }); app.createSession({ sessionId: 'p2' }); app.createSession({ sessionId: 'child', parentSessionId: 'p1' })
  app.transitionSession('child', { parentSessionId: 'p2', reason: 'move' })
  assert.equal(app.readState('child').parentSessionId, 'p2')
  assert.deepEqual(app.topology.parents('child', 'parent').map(edge => edge.fromSessionId), ['p2'])
  app.close()
})

scenario('state transitions replay after event fold', () => {
  const app = appFor('replay')
  app.createSession({ sessionId: 's' }); app.transitionSession('s', { status: 'active' }); app.transitionSession('s', { status: 'error', reason: 'failed' })
  assert.equal(app.replayState('s').status, 'error')
  app.close()
})

scenario('restart preserves state and events', () => {
  let app = appFor('restart'); app.createSession({ sessionId: 's', status: 'active' }); app.close()
  app = appFor('restart'); assert.equal(app.readState('s').status, 'active'); assert.equal(app.events.read('s').length, 1); app.close()
})

scenario('runtime binding generation fencing', () => {
  const app = appFor('generation'); app.createSession({ sessionId: 's' })
  const first = app.bindRuntime('s', identity('native', 'one'))
  const second = app.bindRuntime('s', identity('native', 'two'), first.bindingGeneration)
  assert.equal(second.bindingGeneration, 2)
  assert.throws(() => app.bindRuntime('s', identity('native', 'three'), first.bindingGeneration), /stale/)
  app.close()
})

scenario('ordered batch delivery is FIFO and at-most-once', () => {
  const app = appFor('batch'); app.createSession({ sessionId: 's' }); app.createSession({ sessionId: 'w' }); app.attachWatcher('w', 's')
  app.transitionSession('s', { status: 'active' }); app.transitionSession('s', { status: 'awaiting' });
  const first = app.protocol.dequeue('w'); const second = app.protocol.dequeue('w'); assert.ok(first && second); assert.ok(first.enqueueSeq < second.enqueueSeq); assert.equal(app.protocol.dequeue('w'), null); app.close()
})

scenario('publish before watch is not replayed as a watcher side effect', () => {
  const app = appFor('publish-order'); app.createSession({ sessionId: 's' }); app.createSession({ sessionId: 'w' })
  app.notifyRecipients('s', { kind: 'fixture.before-watch', body: Buffer.from('before') }); app.attachWatcher('w', 's')
  assert.equal(app.protocol.listPending('w').length, 0)
  app.notifyRecipients('s', { kind: 'fixture.after-watch', body: Buffer.from('after') }); assert.equal(app.protocol.dequeue('w').kind, 'fixture.after-watch'); app.close()
})

scenario('independent session pairs do not cross-deliver', () => {
  const app = appFor('pairs'); for (const id of ['a', 'aw', 'b', 'bw']) app.createSession({ sessionId: id })
  app.attachWatcher('aw', 'a'); app.attachWatcher('bw', 'b'); app.notifyRecipients('a', { kind: 'fixture.a', body: Buffer.from('a') })
  assert.equal(app.protocol.dequeue('aw').kind, 'fixture.a'); assert.equal(app.protocol.dequeue('bw'), null); app.close()
})

scenario('JSON migration verifies backup marker and close/reopen', () => {
  const recordsRoot = join(root, 'legacy-sessions'); mkdirSync(join(recordsRoot, 'legacy'), { recursive: true })
  writeFileSync(join(recordsRoot, 'legacy', 'session.json'), JSON.stringify({ session_id: 'legacy', status: 'active', parent: null, createdAt: 7 }))
  const first = migrateJsonSessionRecords({ databasePath: db('migration'), recordsRoot, locality: () => {} })
  const second = migrateJsonSessionRecords({ databasePath: db('migration'), recordsRoot, locality: () => {} })
  assert.equal(first.replayed, false); assert.equal(second.replayed, true); assert.equal(first.sourceDigest, second.sourceDigest)
})

console.log(JSON.stringify({ root, scenarios: results, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length }, null, 2))
if (results.some(result => !result.passed)) process.exitCode = 1
