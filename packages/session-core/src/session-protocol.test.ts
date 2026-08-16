import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { acceptMessage, drain, timelineTail } from './index.js'
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
