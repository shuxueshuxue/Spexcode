import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openProtocol } from '@spexcode/session-protocol'
import { openTopology } from '@spexcode/session-topology'

import { openSessionApplication } from './index.js'

function fixture() {
  const protocol = openProtocol(join(mkdtempSync(join(tmpdir(), 'session-application-')), 'state.sqlite'))
  for (const id of ['parent-a', 'parent-b', 'child']) protocol.initialize(id)
  const topology = openTopology(protocol)
  return { protocol, topology, app: openSessionApplication(protocol, topology) }
}

test('attachAndNotify commits relation and one message per recipient in one unit of work', t => {
  const { protocol, app } = fixture()
  t.after(() => protocol.close())

  const first = app.attachAndNotify('parent-a', 'child', 'watch', {
    kind: 'session.status.v1',
    body: Buffer.from('{"status":"review"}'),
  })
  assert.equal(first.edge?.fromSessionId, 'parent-a')
  assert.deepEqual(first.recipients, ['parent-a'])
  assert.equal(protocol.listPending('parent-a').length, 1)
  assert.equal(protocol.listPending('parent-a')[0]?.senderSessionId, 'child')

  const second = app.attachAndNotify('parent-b', 'child', 'watch', {
    kind: 'session.status.v1',
    body: Buffer.from('{"status":"done"}'),
  })
  assert.deepEqual(second.recipients, ['parent-a', 'parent-b'])
  assert.equal(protocol.listPending('parent-a').length, 2)
  assert.equal(protocol.listPending('parent-b').length, 1)
})
test('notifyRecipients with no subscribers does not invent a message or event', t => {
  const { protocol, app } = fixture()
  t.after(() => protocol.close())
  const result = app.notifyRecipients('child', { kind: 'session.status.v1', body: Buffer.from('idle') })
  assert.deepEqual(result.recipients, [])
  assert.deepEqual(result.messages, [])
  assert.equal(protocol.readMessages('child').length, 0)
})

test('broadcast enqueues one idempotent message per explicit recipient', t => {
  const { protocol, app } = fixture()
  t.after(() => protocol.close())
  const first = app.broadcast('child', ['parent-a', 'parent-b', 'parent-a'], { kind: 'session.text.v1', body: Buffer.from('hello') })
  assert.deepEqual(Object.keys(first), ['parent-a', 'parent-b'])
  assert.equal(protocol.listPending('parent-a').length, 1)
  assert.equal(protocol.listPending('parent-b').length, 1)
  const second = app.broadcast('child', ['parent-a', 'parent-b'], { kind: 'session.text.v1', body: Buffer.from('hello') })
  assert.deepEqual(second, first)
  assert.equal(protocol.listPending('parent-a').length, 1)
})

test('the application service cannot make a partial relation visible after a transaction error', t => {
  const { protocol, topology, app } = fixture()
  t.after(() => protocol.close())
  const originalAttach = topology.attach
  topology.attach = ((tx, from, subject, relation) => {
    const edge = originalAttach(tx, from, subject, relation)
    throw new Error(`forced after attach ${edge.edgeId}`)
  }) as typeof topology.attach

  assert.throws(() => app.attachAndNotify('parent-a', 'child', 'watch', {
    kind: 'session.status.v1',
    body: Buffer.from('review'),
  }), /forced after attach/)
  assert.deepEqual(topology.recipients('child'), [])
  assert.equal(protocol.listPending('parent-a').length, 0)
})
