import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openProtocol } from '@spexcode/session-protocol'
import {
  bindSelfLaunchRuntime,
  resolveSelfLaunchRuntime,
  unbindSelfLaunchRuntime,
} from '@spexcode/session-selflaunch'

const root = mkdtempSync(join(tmpdir(), 'selflaunch-bindings-yatu-'))
try {
  const protocol = openProtocol(join(root, 'sessions.sqlite'))
  try {
    protocol.initialize('self-launch-session')
    protocol.enqueue('self-launch-session', { kind: 'hook.input', body: Buffer.from('hello') })

    const first = bindSelfLaunchRuntime(protocol, 'self-launch-session', {
      nativeSessionId: 'harness-17',
      nativeStartToken: 'start-a',
      metadata: { source: 'real-self-launch-fixture' },
    })
    assert.equal(first.namespace, 'self-launch')
    assert.equal(first.status, 'bound')
    assert.equal(first.bindingGeneration, 1)
    assert.equal(resolveSelfLaunchRuntime(protocol, 'self-launch-session')?.nativeStartToken, 'start-a')

    const second = bindSelfLaunchRuntime(protocol, 'self-launch-session', {
      nativeSessionId: 'harness-17',
      nativeStartToken: 'start-b',
    }, { expectedGeneration: 1 })
    assert.equal(second.bindingGeneration, 2)
    assert.equal(resolveSelfLaunchRuntime(protocol, 'self-launch-session')?.nativeStartToken, 'start-b')

    assert.throws(
      () => bindSelfLaunchRuntime(protocol, 'self-launch-session', {
        nativeSessionId: 'harness-17',
        nativeStartToken: 'stale',
      }, { expectedGeneration: 1 }),
      error => error?.code === 'RUNTIME_BINDING_GENERATION_STALE',
    )

    const unbound = unbindSelfLaunchRuntime(protocol, 'self-launch-session', { expectedGeneration: 2 })
    assert.equal(unbound.status, 'unbound')
    assert.equal(resolveSelfLaunchRuntime(protocol, 'self-launch-session')?.status, 'unbound')
    assert.equal(protocol.listPending('self-launch-session').length, 1)
    process.stdout.write('self-launch-bindings-yatu: 8 assertions passed; pending=1; identity explicit\n')
  } finally {
    protocol.close()
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}
