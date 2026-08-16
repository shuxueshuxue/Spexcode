import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { advanceFollow, followCursor, followedSessions, readCursors, unreadSince } from './session-cursors.js'
import { sessionStoreDir } from '@spexcode/spec-core'
import type { TimelineEvent } from './session-timeline.js'

// A cursor is the ONLY durable state supervision has ([[session-cursors]]). These pin the three claims the
// rest of the mesh leans on: advancing can never skip, a dead target's entry expires by being READ, and a
// reader's unread slice reports EDGES — X→X is not a transition, because the log permanently holds duplicate
// status lines from the retired timeline observer. What a session OWES its agent is not here at all — that is
// a queue ([[delivery-queue]]), not a position.

function withHome<T>(home: string, fn: () => T): T {
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return fn() } finally {
    if (prev === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prev
  }
}
const freshHome = () => mkdtempSync(join(tmpdir(), 'spex-cursors-'))
const ME = 'reader-session'
const status = (s: string, note: string | null = null): TimelineEvent =>
  ({ ts: '2026-07-16T00:00:00.000Z', kind: 'status', status: s as never, proposal: null, note })
const message = (mid: string): TimelineEvent => ({ ts: '2026-07-16T00:00:00.000Z', kind: 'sent', mid, text: mid, from: null })

test('a missing or unparseable cursors file reads as nothing-consumed, never as a skip', () => {
  const home = freshHome()
  withHome(home, () => {
    assert.deepEqual(readCursors(ME), { version: 1, follows: {} })
    mkdirSync(sessionStoreDir(ME), { recursive: true })
    writeFileSync(join(sessionStoreDir(ME), 'cursors.json'), '{ not json at all')
    assert.equal(followCursor(ME, 'target'), null, 'a damaged file re-reads an event rather than losing one')
  })
})

test('the file is written one field per line, so a position reads by exact whole-line match', () => {
  const home = freshHome()
  withHome(home, () => {
    mkdirSync(sessionStoreDir(ME), { recursive: true })
    advanceFollow(ME, ME, 7)
    const raw = readFileSync(join(sessionStoreDir(ME), 'cursors.json'), 'utf8')
    assert.ok(raw.split('\n').some((l) => new RegExp(`^\\s*"${ME}": 7,?$`).test(l)), raw)
  })
})

test('advancing is monotonic — a stale writer can leave a position low, never high', () => {
  const home = freshHome()
  withHome(home, () => {
    mkdirSync(sessionStoreDir(ME), { recursive: true })
    advanceFollow(ME, ME, 5)
    advanceFollow(ME, ME, 2)
    assert.equal(followCursor(ME, ME), 5)
    advanceFollow(ME, ME, 6)
    assert.equal(followCursor(ME, ME), 6)
  })
})

test('a followed session whose store dir is gone expires by being READ, and the next write persists it', () => {
  const home = freshHome()
  withHome(home, () => {
    mkdirSync(sessionStoreDir('worker-a'), { recursive: true })
    mkdirSync(sessionStoreDir('worker-b'), { recursive: true })
    advanceFollow(ME, 'worker-a', 3)
    advanceFollow(ME, 'worker-b', 9)
    assert.deepEqual(followedSessions(ME).sort(), ['worker-a', 'worker-b'])
    assert.equal(followCursor(ME, 'worker-a'), 3)

    rmSync(sessionStoreDir('worker-a'), { recursive: true, force: true })
    assert.equal(followCursor(ME, 'worker-a'), null, 'the follow ended by the target being gone — nothing unregistered')
    assert.deepEqual(followedSessions(ME), ['worker-b'])

    advanceFollow(ME, 'worker-b', 10)
    assert.ok(!readFileSync(join(sessionStoreDir(ME), 'cursors.json'), 'utf8').includes('worker-a'))
  })
})

test('unreadSince reports EDGES: a status repeated in the log is not a second transition', () => {
  // the live shape the retired observer left behind: ONE awaiting move written six times inside ~200ms
  const events = [
    status('active'),
    ...Array.from({ length: 6 }, () => status('awaiting', 'ready')),
    status('active'),
  ]
  const slice = unreadSince(events, 0)
  assert.deepEqual(slice.events.map((e) => e.kind === 'status' ? e.status : e.kind), ['active', 'awaiting', 'active'])
  assert.equal(slice.next, events.length, 'every line read is consumed, duplicates included')
})

test('unreadSince compares against what the reader ALREADY saw, so a duplicate across the cursor is not a move', () => {
  const events = [status('awaiting', 'ready'), status('awaiting', 'ready')]
  assert.deepEqual(unreadSince(events, 1).events, [], 'the second line repeats the status consumed at 0')
  // a genuine re-entry after a different state IS a move, even though the value repeats earlier history
  const reentry = [status('awaiting', 'ready'), status('active'), status('awaiting', 'ready')]
  assert.equal(unreadSince(reentry, 2).events.length, 1)
})

test('unreadSince never drops a message, and an out-of-range cursor is clamped', () => {
  const events = [message('m1'), status('active'), message('m2'), message('m3')]
  assert.deepEqual(unreadSince(events, 2).events.map((e) => e.kind === 'sent' ? e.mid : e.kind), ['m2', 'm3'])
  assert.deepEqual(unreadSince(events, 99).events, [])
  assert.equal(unreadSince(events, -5).events.length, 4)
})
