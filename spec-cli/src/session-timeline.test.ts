import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeEventJson } from '@spexcode/session-events'
import { MIGRATED_MESSAGE_EVENT, MIGRATED_STATE_EVENT } from '@spexcode/session-application'

import { configuredSessionApplicationIfCutover, resetConfiguredSessionApplicationForTest } from './session-application.js'
import {
  currentHumanTurn,
  lastHumanSendVia,
  readTimeline,
  recordStatus,
  timelineDisplay,
  timelineEvents,
  timelineStamp,
} from './session-timeline.js'
import {
  cancelSessionWatch,
  composeSessionPrompt,
  listSessionWatches,
  markState,
  subscribeSessionWatch,
  withNoteReplyHint,
  withTerminalReplyHint,
} from './sessions.js'

const ID = 'timeline-session'
const PARENT = 'timeline-parent'

const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  process.env.SPEXCODE_HOME = home
  // the test worker pins the canonical database path once per process; a fresh home moves it along
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  resetConfiguredSessionApplicationForTest()
  const app = configuredSessionApplicationIfCutover()!
  app.createSession({ sessionId: ID, status: 'idle' })
  app.createSession({ sessionId: PARENT, status: 'idle' })
  return home
}

const app = () => configuredSessionApplicationIfCutover()!

const transition = (status: string, proposal: string | null = null, note: string | null = null): void => {
  app().transitionSession(ID, { status, proposal, note, reason: 'timeline-test' })
}

test('timeline reads canonical state events and preserves declaration history', () => {
  freshHome()
  transition('awaiting', 'nothing', 'CELL_note=17')
  transition('active')
  const timeline = readTimeline(ID)
  assert.ok(timeline)
  assert.deepEqual(timeline.events.filter((event) => event.kind === 'status').map((event) =>
    [event.status, event.proposal, event.note, event.display]), [
    ['idle', null, null, 'idle'],
    ['awaiting', 'nothing', 'CELL_note=17', 'done'],
    ['active', null, null, 'working'],
  ])
  assert.equal(timelineStamp(ID), String(app().readEvents(ID).at(-1)!.eventSeq))
})

test('timeline shows migrated legacy history where it happened, not where it was appended', () => {
  const id = 'timeline-migrated-order'
  app().createSession({ sessionId: id, status: 'idle' })
  app().transitionSession(id, { status: 'active', reason: 'timeline-test' })
  const before = app().readEvents(id).at(-1)!.occurredAtMs
  app().protocol.withTransaction((tx) => {
    app().events.append(tx, { eventId: 'a'.repeat(32), type: MIGRATED_STATE_EVENT, schemaVersion: 1, subjectSessionId: id, ignorable: true, occurredAtMs: before - 5_000, payload: encodeEventJson({ eventId: 'a'.repeat(32), sessionId: id, status: 'active', proposal: null, note: 'legacy launch', parentSessionId: null, reason: 'json-migration-history' }) })
    app().events.append(tx, { eventId: 'b'.repeat(32), type: MIGRATED_MESSAGE_EVENT, schemaVersion: 1, subjectSessionId: id, ignorable: true, occurredAtMs: before - 4_000, payload: encodeEventJson({ messageId: 'legacy-mid', text: 'legacy mail', from: PARENT }) })
  })
  const timeline = readTimeline(id)
  assert.ok(timeline)
  assert.deepEqual(timeline.events.map((event) => event.kind === 'status' ? [event.kind, event.status, event.note] : [event.kind, event.mid, event.from]), [
    ['status', 'active', 'legacy launch'],
    ['sent', 'legacy-mid', PARENT],
    ['status', 'idle', null],
    ['status', 'active', null],
  ])
  // migrated history is a record, not a state fact: replay still ends on the live transition
  assert.equal(app().replayState(id)?.status, 'active')
  assert.equal(timelineStamp(id), String(app().readEvents(id).at(-1)!.eventSeq))
})

test('recordStatus is a canonical write and rejects unknown ids', () => {
  freshHome()
  recordStatus(ID, 'asking', null, 'needs input')
  assert.equal(app().readState(ID)?.status, 'asking')
  assert.throws(() => recordStatus('missing-session', 'error', null, 'gone'), /unknown canonical session/)
})

test('watch relations and delivery debt live in the canonical topology and queue', async () => {
  freshHome()
  assert.deepEqual(await subscribeSessionWatch(PARENT, [ID], 'parent'), { watched: [ID] })
  assert.deepEqual(listSessionWatches(PARENT).map((watch) => watch.target), [ID])
  const pending = app().readPendingMessages(PARENT)
  assert.equal(pending.length, 1, 'attaching a watcher queues the current state through SQLite')
  assert.match(String(pending[0].body), /timeline-session/)
  assert.equal(cancelSessionWatch(PARENT, [ID]), 0, 'manual cancellation cannot remove a structural parent relation')
  assert.deepEqual(listSessionWatches(PARENT).map((watch) => watch.target), [ID])
})

test('a canonical state transition notifies an attached watcher exactly once', async () => {
  freshHome()
  await subscribeSessionWatch(PARENT, [ID], 'parent')
  const before = app().readPendingMessages(PARENT).length
  app().transitionSession(ID, { status: 'asking', note: 'needs a human', reason: 'timeline-test', recipientSessionIds: [PARENT] })
  assert.equal(app().readPendingMessages(PARENT).length, before + 1)
  app().transitionSession(ID, { status: 'active', reason: 'timeline-test', recipientSessionIds: [] })
  assert.equal(app().readPendingMessages(PARENT).length, before + 1, 'working is not an actionable parent wake')
})

test('human channel reconstruction reads only canonical conversation messages', () => {
  freshHome()
  app().enqueueConversationMessage(ID, { kind: 'prompt', body: Buffer.from('note') }, {
    text: 'note', from: null, replyVia: 'note',
  })
  assert.equal(lastHumanSendVia(ID), 'note')
  assert.equal(currentHumanTurn(ID)?.token.length, 32)
  app().enqueueConversationMessage(ID, { kind: 'prompt', body: Buffer.from('terminal') }, {
    text: 'terminal', from: null,
  })
  assert.equal(lastHumanSendVia(ID), null)
  assert.match(currentHumanTurn(ID)?.acceptedAt ?? '', /^20/)
})

test('timeline display maps lifecycle and proposal once', () => {
  assert.equal(timelineDisplay({ status: 'active', proposal: null }), 'working')
  assert.equal(timelineDisplay({ status: 'awaiting', proposal: 'merge' }), 'review')
  assert.equal(timelineDisplay({ status: 'awaiting', proposal: 'close' }), 'close-pending')
  assert.equal(timelineDisplay({ status: 'awaiting', proposal: 'nothing' }), 'done')
  assert.equal(timelineDisplay({ status: 'error', proposal: null }), 'error')
})

test('reply hints are explicit and composable', () => {
  const note = withNoteReplyHint('hello')
  assert.match(note, /REPLY TRANSPORT/)
  assert.match(note, /FINAL tool call a Spex declaration/)
  assert.match(note, /session ask.*done.*park/)
  assert.match(note, /real newline characters/)
  assert.match(note, /never use `String\.raw` or literal backslash\+n/)
  assert.match(note, /`JSON\.stringify\(note\)`/)
  const terminal = withTerminalReplyHint(note)
  assert.match(terminal, /terminal-attached client/)
  assert.match(terminal, /hello/)
})

test('composeSessionPrompt keeps headless defaults and explicit prompt order', async () => {
  const target = { id: ID, harness: 'codex-headless', capabilities: { headless: true } } as never
  const result = await composeSessionPrompt('hello', target)
  assert.match(result.text, /hello/)
  assert.ok(result.text.length > 0)
  assert.equal(result.replyVia, 'note')
})

test('canonical timeline is append-only and repeated states remain visible to the reader', () => {
  freshHome()
  transition('active')
  transition('active')
  const statuses = timelineEvents(ID).filter((event) => event.kind === 'status')
  assert.equal(statuses.length, 3)
  assert.deepEqual(statuses.map((event) => event.status), ['idle', 'active', 'active'])
})
