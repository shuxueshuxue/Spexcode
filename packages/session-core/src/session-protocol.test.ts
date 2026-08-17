import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { acceptMessage, drain, publishRuntimeSessionState, readRuntimeSession, registerRuntimeSession, runtimeSessionChildren, timelineTail } from './index.js'
import { pendingMessages } from './delivery-queue.js'
import { sessionArtifactPath } from '@spexcode/spec-core'
import { settleSentDispatch } from './session-timeline.js'

async function withHome<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = mkdtempSync(join(tmpdir(), 'spex-session-core-'))
  try { return await fn() }
  finally {
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
  }
}

test('the durable protocol does not require a governed SpexCode board record', async () => {
  await withHome(async () => {
    const id = 'runtime-owned-session'
    await acceptMessage({
      target: id,
      text: 'run the child task',
      prepare: async () => ({ text: 'runtime transport bytes' }),
    })

    const handed: string[] = []
    assert.deepEqual(await drain(id, async (message) => { handed.push(message.text); return true }), {
      delivered: 1,
      remaining: 0,
    })
    assert.deepEqual(handed, ['runtime transport bytes'])
    assert.deepEqual(timelineTail(id).map((event) => event.kind), ['sent'])
  })
})

const key = { operation: 'merge', requestDigest: 'request-a', payloadHash: 'payload-a' }

test('a keyed retry restores debt lost after the receipt append, then settles exactly once', async () => {
  await withHome(async () => {
    const id = 'keyed-recovery'
    const first = await acceptMessage({
      target: id,
      text: 'merge it',
      idempotency: key,
      prepare: async () => ({ text: 'prepared merge prompt' }),
    })
    rmSync(sessionArtifactPath(id, 'pending.json'))

    const replay = await acceptMessage({
      target: id,
      text: 'merge it',
      idempotency: key,
      prepare: async () => { throw new Error('a replay must use frozen receipt bytes') },
    })
    assert.deepEqual(replay, { mid: first.mid, replayed: true })
    assert.deepEqual(pendingMessages(id).map((message) => message.text), ['prepared merge prompt'])

    let inserts = 0
    assert.deepEqual(await drain(id, async () => { inserts++; return true }), { delivered: 1, remaining: 0 })
    assert.equal(inserts, 1)

    await acceptMessage({
      target: id,
      text: 'merge it',
      idempotency: key,
      prepare: async () => { throw new Error('a settled replay must not recompose') },
    })
    assert.deepEqual(pendingMessages(id), [], 'a settled receipt does not recreate delivery debt')
  })
})

test('a settled receipt clears a crash-left queue head without inserting it twice', async () => {
  await withHome(async () => {
    const id = 'settled-head'
    const accepted = await acceptMessage({
      target: id,
      text: 'merge it',
      idempotency: key,
      prepare: async () => ({ text: 'prepared merge prompt' }),
    })
    settleSentDispatch(id, accepted.mid)
    let inserts = 0
    assert.deepEqual(await drain(id, async () => { inserts++; return true }), { delivered: 1, remaining: 0 })
    assert.equal(inserts, 0, 'the private settlement proves the agent already received this head')
  })
})

test('an external runtime registers a root and child, then publishes through the canonical parent watch', async () => {
  await withHome(async () => {
    await registerRuntimeSession({
      sessionId: 'z-root', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'main', title: 'root',
    })
    await registerRuntimeSession({
      sessionId: 'z-child', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'zcode/child',
      parentSessionId: 'z-root', title: 'child',
      runtimeMetadata: { agentId: 'agent-1', childToolCallId: 'tool-1' },
    })

    assert.equal(readRuntimeSession('z-root')?.runtimeState, 'registered')
    assert.deepEqual(runtimeSessionChildren('z-root', 'zcode').map((record) => record.sessionId), ['z-child'])
    assert.deepEqual(readRuntimeSession('z-child')?.runtimeMetadata, {
      agentId: 'agent-1', childToolCallId: 'tool-1',
    })
    assert.equal(readRuntimeSession('z-child')?.lifecycle, 'active')

    assert.deepEqual(await publishRuntimeSessionState({
      sessionId: 'z-child', runtimeOwner: 'zcode', revision: 'worker-ready:1', runtimeState: 'running', lifecycle: 'active',
    }), { notified: ['z-root'], replayed: false })

    const handed: string[] = []
    assert.deepEqual(await drain('z-root', async (message) => { handed.push(message.text); return true }), {
      delivered: 1,
      remaining: 0,
    })
    assert.deepEqual(handed, ['[spex watch] z-child is running'])
    assert.deepEqual(timelineTail('z-child').map((event) => event.kind), ['status'])
  })
})

test('runtime registration replay binds opaque metadata without depending on key order', async () => {
  await withHome(async () => {
    await registerRuntimeSession({
      sessionId: 'root', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'main',
    })
    const registration = {
      sessionId: 'child', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'child',
      parentSessionId: 'root', runtimeMetadata: { agentId: 'agent-1', agentType: 'worker' },
    }
    assert.deepEqual(await registerRuntimeSession(registration), { replayed: false })
    assert.deepEqual(await registerRuntimeSession({
      ...registration, runtimeMetadata: { agentType: 'worker', agentId: 'agent-1' },
    }), { replayed: true })
    await assert.rejects(
      registerRuntimeSession({
        ...registration, runtimeMetadata: { agentId: 'agent-2', agentType: 'worker' },
      }),
      /different runtime coordinates/,
    )
  })
})

test('runtime state revision replay restores lost parent debt and a changed reuse fails loud', async () => {
  await withHome(async () => {
    await registerRuntimeSession({ sessionId: 'root', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'main' })
    await registerRuntimeSession({
      sessionId: 'child', runtimeOwner: 'zcode', worktreePath: process.cwd(), branch: 'zcode/child', parentSessionId: 'root',
    })
    const state = {
      sessionId: 'child', runtimeOwner: 'zcode', revision: 'terminal:1', runtimeState: 'need_review',
      lifecycle: 'awaiting' as const, proposal: 'merge' as const, note: 'branch zcode/child is ready',
    }
    await publishRuntimeSessionState(state)
    rmSync(sessionArtifactPath('root', 'pending.json'))

    assert.deepEqual(await publishRuntimeSessionState(state), { notified: ['root'], replayed: true })
    assert.equal(pendingMessages('root').length, 1)
    await assert.rejects(() => publishRuntimeSessionState({ ...state, runtimeState: 'failed', lifecycle: 'error' }), /already bound to another state/)
  })
})
