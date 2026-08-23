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
  first.transitionSession('child', { status: 'awaiting', proposal: 'merge', note: 'ready' })
  const transitioned = first.readState('child')!
  assert.equal(transitioned.sessionId, 'child')
  assert.equal(transitioned.status, 'awaiting')
  assert.equal(transitioned.proposal, 'merge')
  assert.equal(transitioned.note, 'ready')
  assert.equal(transitioned.parentSessionId, 'parent')
  assert.equal(first.listWatchers('parent').length, 1)
  first.detachWatcher('parent', 'child')
  assert.equal(first.listWatchers('parent').length, 0)
  assert.equal(first.protocol.dequeue('parent')?.kind, 'session.state.changed.v1')
  first.close()

  const restarted = openProjectSessionApplication({ databasePath, locality })
  assert.deepEqual(restarted.replayState('child'), {
    sessionId: 'child',
    status: 'awaiting',
    proposal: 'merge',
    note: 'ready',
    parentSessionId: 'parent',
    updatedAtMs: transitioned.updatedAtMs,
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

test('lifecycle publication applies parent and manual watch policies as a union', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-application-watch-policy-'))
  const app = openProjectSessionApplication({ databasePath: join(root, 'sessions.sqlite'), locality: () => {} })
  try {
    app.createSession({ sessionId: 'parent' })
    app.createSession({ sessionId: 'child', parentSessionId: 'parent', status: 'queued' })
    while (app.protocol.dequeue('parent')) { /* discard the creation snapshot */ }

    app.attachWatcher('parent', 'child', 'watch:parent')
    app.transitionSession('child', { status: 'active', reason: 'working' })
    assert.equal(app.protocol.listPending('parent').length, 1, 'queued creation gets one ready-active correction')
    app.protocol.dequeue('parent')

    app.transitionSession('child', { status: 'active', reason: 'working' })
    assert.equal(app.protocol.listPending('parent').length, 0, 'parent-only watch suppresses routine working')

    app.transitionSession('child', { status: 'awaiting', proposal: 'merge', note: 'ready' })
    assert.equal(app.protocol.listPending('parent').length, 1, 'parent-only watch receives actionable transitions')
    app.protocol.dequeue('parent')

    app.attachWatcher('parent', 'child', 'watch:manual')
    app.transitionSession('child', { status: 'active', proposal: null, note: null, reason: 'working' })
    assert.equal(app.protocol.listPending('parent').length, 1, 'manual watch opts into working transitions')
    app.protocol.dequeue('parent')

    app.transitionSession('child', { status: 'awaiting', proposal: 'close', note: 'ready to close' })
    assert.equal(app.protocol.listPending('parent').length, 1, 'overlapping sources enqueue one unioned notification')
  } finally {
    app.close()
  }
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

test('conversation enqueue records the public message fact beside protocol debt in one transaction', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-application-conversation-'))
  const databasePath = join(root, 'sessions.sqlite')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: 'conversation' })

  const queued = app.enqueueConversationMessage('conversation', {
    kind: 'session.prompt.v1',
    body: Buffer.from('transport-only-hint'),
    senderSessionId: null,
    idempotencyKey: 'conversation-message-1',
  }, { text: 'the visible prompt', from: null, replyVia: 'note' })

  assert.equal(app.protocol.listPending('conversation').length, 1)
  const events = app.events.read('conversation')
  const messageEvent = events.find(event => event.type === 'session.message.sent.v1')
  assert.ok(messageEvent)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(messageEvent.payload)), {
    from: null,
    messageId: queued.messageId,
    replyVia: 'note',
    text: 'the visible prompt',
  })
  app.close()
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

test('a caller-owned recipient policy can suppress routine parent delivery without losing actionable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-application-recipient-policy-'))
  const databasePath = join(root, 'sessions.sqlite')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: 'parent' })
  app.createSession({ sessionId: 'manual' })
  app.createSession({ sessionId: 'child' })
  app.attachWatcher('parent', 'child', 'watch:parent')
  app.attachWatcher('manual', 'child', 'watch:manual')

  app.transitionSession('child', { status: 'active', recipientSessionIds: ['manual'] })
  assert.equal(app.protocol.listPending('parent').length, 0)
  assert.equal(app.protocol.listPending('manual').length, 1)

  app.transitionSession('child', { status: 'awaiting', proposal: 'merge', recipientSessionIds: ['parent', 'manual'] })
  assert.equal(app.protocol.listPending('parent').length, 1)
  assert.equal(app.protocol.listPending('manual').length, 2)
  app.close()
})
