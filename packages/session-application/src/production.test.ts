import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { RuntimeBindingError } from '@spexcode/session-runtime'

import { openProjectSessionApplication } from './production.js'

const identity = (nativeSessionId: string, nativeStartToken: string) => ({
  namespace: 'spex-governed',
  runtimeKind: 'fixture',
  nativeSessionId,
  nativeStartToken,
})

test('production composition runs the parent/child state, event, replay, publish, and binding fence story', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-application-production-'))
  const databasePath = join(root, 'sessions.sqlite')
  const localityCalls: string[] = []
  const locality = (path: string) => localityCalls.push(path)

  const first = openProjectSessionApplication({ databasePath, locality })
  const parent = first.createSession({ sessionId: 'parent', runtime: identity('parent-native', 'parent-start-1') })
  const child = first.createSession({ sessionId: 'child', parentSessionId: parent.sessionId, runtime: identity('child-native', 'child-start-1') })
  assert.equal(child.parentSessionId, 'parent')
  assert.deepEqual(first.topology.children('parent', 'parent').map(edge => edge.toSessionId), ['child'])

  first.attachWatcher('parent', 'child', 'watch')
  const direct = first.enqueueMessage('parent', { kind: 'fixture.direct.v1', body: Buffer.from('direct') })
  assert.equal(direct.kind, 'fixture.direct.v1')
  first.transitionSession('child', { status: 'active', reason: 'started' })
  const childEvents = first.events.read('child')
  assert.equal(childEvents.length, 2)
  assert.equal(childEvents[1]?.type, 'session.state.changed.v1')
  assert.equal(first.protocol.listPending('parent').length, 3)
  assert.equal(first.protocol.dequeue('parent')?.kind, 'session.state.changed.v1')
  assert.equal(first.protocol.dequeue('parent')?.kind, 'fixture.direct.v1')
  assert.equal(first.protocol.dequeue('parent')?.kind, 'session.state.changed.v1')
  first.close()

  const restarted = openProjectSessionApplication({ databasePath, locality })
  assert.deepEqual(restarted.replayState('child'), {
    sessionId: 'child',
    status: 'active',
    proposal: null,
    note: null,
    parentSessionId: 'parent',
    updatedAtMs: childEvents[1]!.occurredAtMs,
  })
  const watcherBinding = restarted.bindRuntime('parent', identity('parent-native', 'parent-start-2'), 1)
  assert.equal(watcherBinding.bindingGeneration, 2)
  assert.throws(
    () => restarted.bindRuntime('parent', identity('parent-native', 'parent-start-3'), 1),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_GENERATION_STALE',
  )
  const published = restarted.notifyRecipients('child', {
    kind: 'fixture.notification.v1',
    body: Buffer.from('published-after-restart'),
  })
  assert.deepEqual(published.recipients, ['parent'])
  const delivered = restarted.dequeueForRuntime('parent', 'spex-governed', watcherBinding.bindingGeneration)
  assert.equal(delivered?.kind, 'fixture.notification.v1')
  assert.equal(restarted.dequeueForRuntime('parent', 'spex-governed', watcherBinding.bindingGeneration), null)
  restarted.close()
  assert.deepEqual(localityCalls, [databasePath, databasePath])
})

test('production composition refuses missing locality and relative database paths before opening', () => {
  assert.throws(
    () => openProjectSessionApplication({ databasePath: 'relative.sqlite', locality: () => {} }),
    /absolute databasePath/,
  )
  assert.throws(
    () => openProjectSessionApplication({ databasePath: join(tmpdir(), 'no-locality.sqlite'), locality: undefined as never }),
    /locality precondition/,
  )
})

test('protocol addresses without migrated application state are absent and read-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-application-unmigrated-'))
  const databasePath = join(root, 'sessions.sqlite')
  const first = openProjectSessionApplication({ databasePath, locality: () => {} })
  first.protocol.initialize('unmigrated')
  assert.equal(first.readState('unmigrated'), null)
  first.close()

  const reopened = openProjectSessionApplication({ databasePath, locality: () => {} })
  assert.throws(() => reopened.transitionSession('unmigrated', { status: 'active' }), /application state is missing/)
  reopened.close()
})
