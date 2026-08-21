import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openProtocol } from '@spexcode/session-protocol'

import { openRuntimeBindings, RuntimeBindingError } from './index.js'

function fixture() {
  const protocol = openProtocol(join(mkdtempSync(join(tmpdir(), 'session-runtime-')), 'protocol.sqlite'))
  protocol.initialize('session-1')
  return { protocol, bindings: openRuntimeBindings(protocol) }
}

const identity = {
  namespace: 'zswarm',
  runtimeKind: 'harness',
  nativeSessionId: 'native-1',
  nativeStartToken: 'start-1',
  metadata: { role: 'worker', attempt: 1 },
}

test('bind, resolve, generation fence, and unbind preserve the protocol address', t => {
  const { protocol, bindings } = fixture()
  t.after(() => protocol.close())

  const first = protocol.withTransaction(tx => bindings.bind(tx, 'session-1', identity, { now: 10 }))
  assert.equal(first.bindingGeneration, 1)
  assert.deepEqual(first.metadata, identity.metadata)
  assert.equal(bindings.resolve('zswarm', 'session-1')?.nativeSessionId, 'native-1')

  assert.throws(
    () => protocol.withTransaction(tx => bindings.bind(tx, 'session-1', { ...identity, nativeSessionId: 'native-2' })),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_GENERATION_REQUIRED',
  )
  const second = protocol.withTransaction(tx => bindings.bind(tx, 'session-1', { ...identity, nativeSessionId: 'native-2' }, { expectedGeneration: 1, now: 20 }))
  assert.equal(second.bindingGeneration, 2)
  assert.equal(second.nativeSessionId, 'native-2')
  assert.throws(
    () => protocol.withTransaction(tx => bindings.unbind(tx, 'zswarm', 'session-1', { expectedGeneration: 1 })),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_GENERATION_STALE',
  )
  const unbound = protocol.withTransaction(tx => bindings.unbind(tx, 'zswarm', 'session-1', { expectedGeneration: 2, now: 30 }))
  assert.equal(unbound.status, 'unbound')
  assert.equal(unbound.bindingGeneration, 3)
  assert.equal(protocol.listPending('session-1').length, 0)
})

test('unknown and retired protocol addresses cannot receive bindings', t => {
  const { protocol, bindings } = fixture()
  t.after(() => protocol.close())
  assert.throws(
    () => protocol.withTransaction(tx => bindings.bind(tx, 'missing', identity)),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_SESSION_UNKNOWN',
  )
  protocol.retire('session-1')
  assert.throws(
    () => protocol.withTransaction(tx => bindings.bind(tx, 'session-1', identity)),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_SESSION_RETIRED',
  )
})

test('unbinding does not dequeue, requeue, or retire the protocol address', t => {
  const { protocol, bindings } = fixture()
  t.after(() => protocol.close())
  protocol.enqueue('session-1', { kind: 'work', body: new Uint8Array([1, 2, 3]) })
  protocol.withTransaction(tx => bindings.bind(tx, 'session-1', identity))
  protocol.withTransaction(tx => bindings.unbind(tx, 'zswarm', 'session-1', { expectedGeneration: 1 }))
  assert.equal(protocol.listPending('session-1').length, 1)
  assert.equal(protocol.dequeue('session-1')?.kind, 'work')
  assert.equal(protocol.retire('session-1').sessionId, 'session-1')
})

test('metadata is bounded and must be a JSON object', t => {
  const { protocol, bindings } = fixture()
  t.after(() => protocol.close())
  assert.throws(
    () => protocol.withTransaction(tx => bindings.bind(tx, 'session-1', { ...identity, metadata: [] as unknown as Record<string, unknown> })),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_METADATA_INVALID',
  )
  assert.throws(
    () => protocol.withTransaction(tx => bindings.bind(tx, 'session-1', { ...identity, metadata: { value: 'x'.repeat(8192) } })),
    (error: unknown) => error instanceof RuntimeBindingError && error.code === 'RUNTIME_BINDING_METADATA_INVALID',
  )
})
