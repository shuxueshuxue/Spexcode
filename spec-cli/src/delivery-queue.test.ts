import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { drain, enqueue, owesDelivery, pendingMessages, revokeSenderDelivery, type PendingMessage } from './delivery-queue.js'
import { sessionArtifactPath, sessionStoreDir } from './layout.js'

// What a session OWES its agent ([[delivery-queue]]). These pin the claims the mesh leans on: an entry leaves
// only when the adapter TOOK it, order survives a refusal, the resting state is a file that does not exist,
// and a session that predates the queue owes nothing — which is why no backlog migration exists.

function withHome<T>(home: string, fn: () => T): T {
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return fn() } finally {
    if (prev === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prev
  }
}
async function withHomeAsync<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return await fn() } finally {
    if (prev === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prev
  }
}
const freshHome = () => mkdtempSync(join(tmpdir(), 'spex-queue-'))
const ID = 'owing-session'
const msg = (mid: string): PendingMessage => ({ mid, text: `body of ${mid}`, from: null })

test('a session that never enqueued owes nothing — which is what spares an old log from being replayed', () => {
  withHome(freshHome(), () => {
    mkdirSync(sessionStoreDir(ID), { recursive: true })
    // a long pre-existing timeline is history, and history is not a work list
    writeFileSync(sessionArtifactPath(ID, 'timeline.ndjson'),
      Array.from({ length: 748 }, (_, i) => JSON.stringify({ ts: 'x', kind: 'sent', mid: `m${i}`, text: 'old', from: null })).join('\n') + '\n')
    assert.equal(owesDelivery(ID), false)
    assert.deepEqual(pendingMessages(ID), [])
  })
})

test('an empty queue is a file that does not exist, so "anything owed?" is one existsSync', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('a'))
    assert.equal(owesDelivery(ID), true)
    await drain(ID, async () => true)
    assert.equal(owesDelivery(ID), false)
    assert.equal(existsSync(sessionArtifactPath(ID, 'pending.json')), false)
  })
})

test('an entry leaves only when the adapter TOOK it', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('a'))
    const refused = await drain(ID, async () => false)
    assert.deepEqual(refused, { delivered: 0, remaining: 1 })
    assert.equal(pendingMessages(ID).length, 1, 'a refusal leaves the debt standing')
    const taken = await drain(ID, async () => true)
    assert.deepEqual(taken, { delivered: 1, remaining: 0 })
  })
})

test('an insert that THROWS is a refusal, not a lost message', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('a'))
    const r = await drain(ID, async () => { throw new Error('socket died mid-write') })
    assert.deepEqual(r, { delivered: 0, remaining: 1 })
    assert.deepEqual(pendingMessages(ID).map((m) => m.mid), ['a'])
  })
})

test('order survives a refusal: a message is never skipped to hand over a later one', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('first'))
    enqueue(ID, msg('second'))
    enqueue(ID, msg('third'))
    const handed: string[] = []
    // the adapter takes the first, then refuses — the pass must STOP rather than move on to `third`
    const r = await drain(ID, async (m) => { if (m.mid !== 'first') return false; handed.push(m.mid); return true })
    assert.deepEqual(handed, ['first'])
    assert.deepEqual(r, { delivered: 1, remaining: 2 })
    assert.deepEqual(pendingMessages(ID).map((m) => m.mid), ['second', 'third'], 'and in the order they were said')
  })
})

test('a send that lands DURING a pass is not swallowed by the removal that follows it', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('a'))
    const handed: string[] = []
    await drain(ID, async (m) => {
      handed.push(m.mid)
      // a concurrent sendText appends to the tail while this insert is in flight; removing a STALE snapshot
      // minus the head would drop it silently
      if (m.mid === 'a') enqueue(ID, msg('arrived-mid-pass'))
      return true
    })
    assert.deepEqual(handed, ['a', 'arrived-mid-pass'])
    assert.equal(owesDelivery(ID), false)
  })
})

test('the lock spans the insert, so two concurrent passes cannot both hand over one message', async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, msg('only-once'))
    let handed = 0
    const slowInsert = async (): Promise<boolean> => {
      handed++
      await new Promise((r) => setTimeout(r, 40))
      return true
    }
    const [a, b] = await Promise.all([drain(ID, slowInsert), drain(ID, slowInsert)])
    assert.equal(handed, 1, 'the second pass found the queue already emptied — or declined the lock')
    assert.equal(a.delivered + b.delivered, 1)
    assert.equal(owesDelivery(ID), false)
  })
})

test('an unparseable queue file reads as nothing owed rather than throwing on the hot path', () => {
  withHome(freshHome(), () => {
    mkdirSync(sessionStoreDir(ID), { recursive: true })
    writeFileSync(sessionArtifactPath(ID, 'pending.json'), '{ not json at all')
    assert.deepEqual(pendingMessages(ID), [])
  })
})

test("a closed sender's queued debt is void and cannot block the recipient queue", async () => {
  const home = freshHome()
  await withHomeAsync(home, async () => {
    enqueue(ID, { mid: 'closed', text: 'late command', from: 'closed-supervisor' })
    enqueue(ID, msg('later-human-message'))
    revokeSenderDelivery('closed-supervisor')
    const handed: string[] = []
    const result = await drain(ID, async (entry) => { handed.push(entry.mid); return true })
    assert.deepEqual(handed, ['later-human-message'])
    assert.deepEqual(result, { delivered: 1, remaining: 0 })
  })
})
