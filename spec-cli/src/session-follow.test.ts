import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { followSessions, launchEvent, sessionEvent, type FollowOutcome } from './session-follow.js'
import { advanceFollow, followCursor } from './session-cursors.js'
import { sessionStoreDir } from './layout.js'
import type { Session } from './sessions.js'

// Following is reading a LOG past a cursor ([[session-follow]]). Everything below is driven by appending lines
// to timeline.ndjson and by nothing else: no board, no backend, no process. That is the point — if any of this
// needed a running server to pass, the mechanism would still be costing the control plane what it used to.

const ME = 'follower-session'
const T = 'target-session'
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'spex-follow-'))
  process.env.SPEXCODE_HOME = home
  mkdirSync(sessionStoreDir(ME), { recursive: true })
  mkdirSync(sessionStoreDir(T), { recursive: true })
  return home
}
const log = (id: string) => join(sessionStoreDir(id), 'timeline.ndjson')
function status(id: string, s: string, proposal: string | null = null, note: string | null = null): void {
  appendFileSync(log(id), JSON.stringify({ ts: new Date().toISOString(), kind: 'status', status: s, proposal, note }) + '\n')
}
const sent = (id: string, text: string, from: string | null = null): void => {
  appendFileSync(log(id), JSON.stringify({ ts: new Date().toISOString(), kind: 'sent', mid: text, text, from }) + '\n')
}
// drive the target's log on a timer while the follow is already running — a transition only counts if the
// follower OBSERVES it happen, so nothing here may be pre-written into the arrival prefix.
const later = (ms: number, fn: () => void): void => { setTimeout(fn, ms).unref() }
const take = (opts: Partial<Parameters<typeof followSessions>[1]> = {}): Promise<FollowOutcome> =>
  followSessions(() => {}, { targets: () => [T], self: ME, take: true, timeoutMs: 1000, intervalMs: 5, ...opts })

const titled = (): Session => ({
  id: T, node: 'legacy-node-handle', branch: 'node/legacy-node-handle', path: '/wt/title',
  label: 'legacy-node-handle', title: 'current work summary', raw: { name: null, title: 'stored title' },
  parent: null, harness: 'claude', capabilities: { headless: false }, launcher: null,
  lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online', note: null,
  archived: false, archiveHazard: null, prompt: null, promptPreview: null, created: 0, activity: 'current work summary', sortKey: null, files: [],
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
  assert.equal(followCursor(ME, T), 2, 'the cursor names the next unread line')
  // the same actionable state is already consumed, so a fresh follow must NOT re-return it
  const r = await take()
  assert.deepEqual(r, { timedOut: true, path: ['asking'] })
})

test('a followed session whose store dir is gone is the gone outcome, not a timeout', async () => {
  const home = freshHome()
  status(T, 'active')
  later(30, () => rmSync(sessionStoreDir(T), { recursive: true, force: true }))
  const r = await take()
  assert.deepEqual(r, { gone: T })
  assert.ok(existsSync(home))
})

test('a message arriving for the follower returns it — that is the other thing a wait wakes on', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => sent(ME, 'the merge landed', 'someone-else'))
  const r = await take()
  assert.deepEqual(r, { mail: { from: 'someone-else', text: 'the merge landed' } })
})

// A wait that STOPS on an event leaves it unread, so the next wait resumes on it rather than skipping past.
// Watching one's own log is a watch, never a handover — the agent gets the message as a prompt
// ([[delivery-queue]]), so this position cannot make it miss mail either way.
test('waking on mail leaves the follower own-log position where it was', async () => {
  freshHome()
  sent(ME, 'unread')
  const r = await followSessions(() => {}, { targets: () => [T], self: ME, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.ok('mail' in r)
  const { followCursor } = await import('./session-cursors.js')
  assert.equal(followCursor(ME, ME) ?? 0, 0, 'the event it stopped on stays unread')
})

test('a follow with no session record of its own keeps its cursors in memory and still works', async () => {
  freshHome()
  status(T, 'active')
  later(30, () => status(T, 'awaiting', 'merge'))
  const r = await followSessions(() => {}, { targets: () => [T], self: null, take: true, timeoutMs: 1000, intervalMs: 5 })
  assert.deepEqual(r, { reached: 'review', id: T, path: ['working', 'review'] })
  assert.equal(followCursor(ME, T), null, 'nothing was written to a record this follower does not have')
})

test('a session that launches mid-follow is read from its first line, so its arrival is not missed', async () => {
  freshHome()
  const LATE = 'late-session'
  let ids = [T]
  status(T, 'active')
  later(30, () => {
    mkdirSync(sessionStoreDir(LATE), { recursive: true })
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
  advanceFollow(ME, T, 1)   // the follower had consumed only the first line before it died
  const r = await take()
  assert.deepEqual(r, { reached: 'review', id: T, path: ['working', 'review'] })
})
