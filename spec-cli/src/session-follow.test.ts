import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { followSessions, launchEvent, sessionEvent, type FollowOutcome } from './session-follow.js'
import { configuredSessionApplication, resetConfiguredSessionApplicationForTest } from './session-application.js'
import { recordStatus } from './session-timeline.js'
import type { Session } from './sessions.js'

// Following reads canonical application events past a cursor ([[session-follow]]). Everything below is driven by
// SQLite state and by nothing else: no board, no backend, no process. That is the point — if any of this needed a
// running server to pass, the mechanism would still be costing the control plane what it used to.

const ME = 'follower-session'
const T = 'target-session'
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'spex-follow-'))
  resetConfiguredSessionApplicationForTest()
  process.env.SPEXCODE_HOME = home
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  configuredSessionApplication()!.createSession({ sessionId: ME, status: 'idle' })
  return home
}
function status(id: string, s: string, proposal: string | null = null, note: string | null = null): void {
  const application = configuredSessionApplication()!
  if (application.readState(id)) application.transitionSession(id, { status: s, proposal, note, reason: 'follow-test' })
  else application.createSession({ sessionId: id, status: s, proposal, note })
}
const sent = (id: string, text: string, from: string | null = null): void => {
  const application = configuredSessionApplication()!
  if (!application.readState(id)) application.createSession({ sessionId: id, status: 'idle' })
  application.enqueueConversationMessage(id, { kind: 'session.prompt.v1', body: Buffer.from(text), senderSessionId: from, idempotencyKey: `follow-test:${id}:${text}` }, { text, from })
}
// drive the target's log on a timer while the follow is already running — a transition only counts if the
// follower OBSERVES it happen, so nothing here may be pre-written into the arrival prefix.
const later = (ms: number, fn: () => void): void => { setTimeout(fn, ms).unref() }
const take = (opts: Partial<Parameters<typeof followSessions>[1]> = {}): Promise<FollowOutcome> =>
  followSessions(() => {}, { targets: () => [T], self: ME, take: true, timeoutMs: 1000, intervalMs: 5, ...opts })

const titled = (): Session => ({
  id: T, branch: 'node/legacy-node-handle', path: '/wt/title',
  label: 'legacy-node-handle', title: 'current work summary', raw: { name: null, title: 'stored title' },
  parent: null, harness: 'claude', capabilities: { headless: false }, launcher: null,
  lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online', note: null,
  archived: false, closedAt: null, archiveHazard: null, prompt: null, promptPreview: null, created: 0, activity: 'current work summary', sortKey: null, files: [],
})

test('follow notifications render the derived title, never the selector label', async () => {
  freshHome()
  const s = titled()
  assert.match(sessionEvent(s), /current work summary/)
  assert.match(launchEvent(s), /current work summary/)
  assert.doesNotMatch(sessionEvent(s), /legacy-node-handle/)
  assert.doesNotMatch(launchEvent(s), /legacy-node-handle/)

  status(T, 'active')
  const lines: string[] = []
  later(30, () => sent(T, 'check this', 'human'))
  later(60, () => status(T, 'awaiting', 'merge'))
  await followSessions((line) => lines.push(line), {
    targets: () => [T], self: ME, take: true, timeoutMs: 1000, intervalMs: 5, row: () => s,
  })
  const message = lines.find((line) => line.includes('[spex] message')) || ''
  assert.match(message, /current work summary/)
  assert.doesNotMatch(message, /legacy-node-handle/)
})

test('an already-actionable arrival is not an edge; the rise out of non-actionable is', async () => {
  freshHome()
  status(T, 'awaiting', 'merge')   // the standing `review` level a level-triggered wait falsely returned on
  later(30, () => status(T, 'active'))
  later(80, () => status(T, 'awaiting', 'close'))
  const r = await take()
  assert.deepEqual(r, { reached: 'close-pending', id: T, path: ['review', 'working', 'close-pending'] })
})

test('an actionable→actionable hop never returns — the timeout carries the observed path', async () => {
  freshHome()
  status(T, 'awaiting', 'merge')
  later(30, () => status(T, 'awaiting', 'nothing'))
  const r = await take()
  assert.deepEqual(r, { timedOut: true, path: ['review', 'done'] })
})

// THE history-duplicate immunity. Every stray `spex serve` used to re-record each real move, so the log
// permanently holds runs of identical status lines (one measured transition landed as six). Those bytes are
// history and cannot be rewritten, so the READ decides what a transition is: X→X is not one.
test('a status repeated in the log is one transition, not six', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => { for (let i = 0; i < 6; i++) status(T, 'awaiting', 'merge') })
  const observed: Array<[string, string | null]> = []
  const r = await take({ onObserved: (_id, st, was) => observed.push([st, was]) })
  assert.deepEqual(r, { reached: 'review', id: T, path: ['working', 'review'] })
  assert.deepEqual(observed, [['working', null], ['review', 'working']], 'the five duplicates are consumed, never narrated')
})

// Two moves in quick succession are two LINES, so a take-one wait must leave the second unread rather than
// swallowing the tail of the tick it stopped in — the loss that sampling made unavoidable.
test('a wait consumes only up to the event it stopped on; the next wait takes the one behind it', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => { status(T, 'awaiting', 'merge'); status(T, 'active'); status(T, 'error') })
  assert.deepEqual(await take(), { reached: 'review', id: T, path: ['working', 'review'] })
  assert.deepEqual(await take(), { reached: 'error', id: T, path: ['review', 'working', 'error'] })
})

test('a stored cursor is the resume: a restarted follower starts where it stopped, not at the log head', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => status(T, 'asking', null, 'which branch?'))
  await take()
  assert.equal(configuredSessionApplication()!.readFollowCursor(ME, T), 2, 'the cursor names the next unread line')
  // the same actionable state is already consumed, so a fresh follow must NOT re-return it
  const r = await take()
  assert.deepEqual(r, { timedOut: true, path: ['asking'] })
})

test('a followed session whose store dir is gone is the gone outcome, not a timeout', async () => {
  const home = freshHome()
  const r = await followSessions(() => {}, { targets: () => ['gone-session'], self: ME, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(r, { gone: 'gone-session' })
  assert.ok(existsSync(home))
})

test('a message arriving for the follower returns it — that is the other thing a wait wakes on', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => sent(ME, 'the merge landed', 'someone-else'))
  const r = await take()
  assert.deepEqual(r, { mail: { from: 'someone-else', text: 'the merge landed' } })
})

// A take wait consumes the returned inbox message. Its own cursor must move past that message, otherwise an
// empty cursor makes every subsequent wait return the same oldest mail.
test('waking on mail advances the follower own-log cursor and takes the next message next', async () => {
  freshHome()
  sent(ME, 'unread')
  sent(ME, 'second')
  const first = await followSessions(() => {}, { targets: () => [], self: ME, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(first, { mail: { from: null, text: 'unread' } })
  assert.equal(configuredSessionApplication()!.readFollowCursor(ME, ME), 2)
  const second = await followSessions(() => {}, { targets: () => [], self: ME, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(second, { mail: { from: null, text: 'second' } })
  assert.equal(configuredSessionApplication()!.readFollowCursor(ME, ME), 3)
})

test('a follow with no session record of its own keeps its cursors in memory and still works', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => status(T, 'awaiting', 'merge'))
  const r = await followSessions(() => {}, { targets: () => [T], self: null, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(r, { reached: 'review', id: T, path: ['working', 'review'] })
  assert.equal(configuredSessionApplication()!.readFollowCursor(ME, T), null, 'nothing was written to a record this follower does not have')
})

test('a session that launches mid-follow is read from its first line, so its arrival is not missed', async () => {
  freshHome()
  const LATE = 'late-session'
  let ids = [T]
  status(T, 'active')
  later(30, () => {
    status(LATE, 'active')
    ids = [T, LATE]
    later(40, () => status(LATE, 'awaiting', 'merge'))
  })
  const r = await followSessions(() => {}, { targets: () => ids, self: ME, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(r, { reached: 'review', id: LATE, path: ['working', 'review'] })
})

test('a pre-seeded follow cursor replays exactly the lines behind it', async () => {
  freshHome()
  status(T, 'active')
  status(T, 'awaiting', 'merge')
  configuredSessionApplication()!.advanceFollowCursor(ME, T, 1)   // the follower had consumed only the first line before it died
  const r = await take()
  assert.deepEqual(r, { reached: 'review', id: T, path: ['working', 'review'] })
})

test('a wait crosses a rotation boundary without skipping its actionable edge', async () => {
  freshHome()
  const previous = process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
  process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = '1024'
  try {
    status(T, 'active', null, 'x'.repeat(900))
    later(30, () => status(T, 'awaiting', 'merge', 'y'.repeat(900)))
    assert.deepEqual(await take(), { reached: 'review', id: T, path: ['working', 'review'] })
    assert.equal(configuredSessionApplication()!.readFollowCursor(ME, T), 2, 'the durable event-index cursor still spans canonical history')
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
    else process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = previous
  }
})

test('a 13-session fleet follow resumes across 1,664 sealed history events', async () => {
  freshHome()
  const previous = process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
  process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = '1024'
  const fleet = Array.from({ length: 13 }, (_, index) => `fleet-${String(index).padStart(2, '0')}`)
  try {
    for (const id of fleet) {
      for (let event = 0; event < 128; event++) status(id, 'active', null, `${id}:${String(event).padStart(3, '0')}:${'x'.repeat(1200)}`)
    }

    let arrivals = 0
    const result = await followSessions(() => {}, {
      targets: () => fleet,
      self: ME,
      take: true,
      timeoutMs: 10_000,
      intervalMs: 5,
      onObserved: (_id, status, previousStatus) => {
        if (status !== 'working' || previousStatus !== null || ++arrivals !== fleet.length) return
        later(50, () => recordStatus(fleet.at(-1)!, 'awaiting', 'merge', `fleet-review:${'y'.repeat(1200)}`))
      },
    })

    assert.deepEqual(result, { reached: 'review', id: fleet.at(-1), path: ['working', 'review'] })
    assert.equal(configuredSessionApplication()!.readFollowCursor(ME, fleet.at(-1)!), 129, 'the event-index cursor resumes across canonical history')
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
    else process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = previous
  }
})
