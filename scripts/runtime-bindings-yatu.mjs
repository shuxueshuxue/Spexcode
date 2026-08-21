import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openProtocol } from '@spexcode/session-protocol'
import { openRuntimeBindings } from '@spexcode/session-runtime'

const root = mkdtempSync(join(tmpdir(), 'runtime-bindings-yatu-'))
const protocol = openProtocol(join(root, 'session.sqlite'))
try {
  const bindings = openRuntimeBindings(protocol)
  protocol.initialize('swarm-session')
  const identity = {
    namespace: 'zswarm',
    runtimeKind: 'harness',
    nativeSessionId: 'harness-42',
    nativeStartToken: 'start-1',
    metadata: { project: 'fixture', role: 'worker' },
  }
  const bound = protocol.withTransaction(tx => bindings.bind(tx, 'swarm-session', identity, { now: 100 }))
  assert.equal(bound.status, 'bound')
  assert.equal(bindings.resolve('zswarm', 'swarm-session')?.nativeSessionId, 'harness-42')
  protocol.enqueue('swarm-session', { kind: 'input', body: new Uint8Array([0x6f, 0x6b]) })
  const unbound = protocol.withTransaction(tx => bindings.unbind(tx, 'zswarm', 'swarm-session', {
    expectedGeneration: bound.bindingGeneration,
    now: 200,
  }))
  assert.equal(unbound.status, 'unbound')
  assert.equal(protocol.listPending('swarm-session').length, 1)
  assert.equal(protocol.dequeue('swarm-session')?.kind, 'input')
  console.log(JSON.stringify({
    scenario: 'installed-runtime-bindings-clean-consumer',
    bindingGeneration: unbound.bindingGeneration,
    pendingBeforeDequeue: 1,
    delivered: true,
  }))
} finally {
  protocol.close()
}
