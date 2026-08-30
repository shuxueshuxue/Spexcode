import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSession, deriveLabel, deriveTitle, sessionLabel, sessionTitle } from './sessions.js'
import type { SessRec } from './session-record.js'

// Pins the session-label contract ([[session-label]]): display strings are DERIVED in exactly one place
// and the bare parts (rename `name`, prompt-truncation `title`) never ride the wire at the top level. The
// wire-shape assertions are the enforcement half — a future field "helpfully" re-exposed at the top level
// fails here before any surface can grow a bypass chain on it.

const rec = (over: Partial<SessRec> = {}): SessRec => ({
  session: 'sess-1', governed: true, worktreePath: '/wt/x', branch: 'node/x-1', node: 'x',
  title: 'seven word prompt truncation title here', name: null, parent: null,
  status: 'active', proposal: null, merges: 0, note: null, sortKey: null, createdAt: 1,
  harness: 'claude', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null, launcher: null, launchCmd: null, launchOwner: null,
  ...over,
})

test('wire shape: one derived title plus stable handle; raw parts stay nested', () => {
  const s = toSession(rec({ name: 'My Rename' }), 'working', 'online', '✳ ignored-here')
  assert.equal(s.title, 'My Rename')
  assert.equal('name' in s, false, 'bare name must not ride the wire')
  assert.equal(s.raw.name, 'My Rename')
  assert.equal(s.raw.title, 'seven word prompt truncation title here')
  assert.equal(typeof s.label, 'string')
  assert.equal('headline' in s, false, 'headline must not ride the wire')
  assert.deepEqual(s.capabilities, { headless: false })
})

test('wire shape projects console capabilities from the harness adapter', () => {
  const s = toSession(rec({ harness: 'claude-headless' }), 'working', 'online')
  assert.deepEqual(s.capabilities, { headless: true })
})

test('label precedence: name > node > title > branch > id', () => {
  assert.equal(deriveLabel({ id: 'i', name: 'N', node: 'nd', title: 't', branch: 'b' }), 'N')
  assert.equal(deriveLabel({ id: 'i', name: null, node: 'nd', title: 't', branch: 'b' }), 'nd')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: 't', branch: 'b' }), 't')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: null, branch: 'b' }), 'b')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: null, branch: null }), 'i')
})

test('title precedence: name > activity > note > promptPreview > node > …', () => {
  const parts = { id: 'i', name: null, node: 'nd', title: 't', branch: 'b', activity: 'doing X', promptPreview: 'the ask' }
  assert.equal(deriveTitle(parts), 'doing X')
  assert.equal(deriveTitle({ ...parts, activity: null, note: 'waiting for review' }), 'waiting for review')
  assert.equal(deriveTitle({ ...parts, activity: null, note: null }), 'the ask')
  assert.equal(deriveTitle({ ...parts, name: 'N' }), 'N', 'a user rename wins over the live activity')
  assert.equal(deriveTitle({ ...parts, activity: null, note: null, promptPreview: null }), 'nd')
})

test('title skips a bare URL prompt when the next line carries the task', () => {
  assert.equal(deriveTitle({
    id: 'i', name: null, activity: null, note: null, node: null, title: null, branch: null,
    promptPreview: 'https://github.com/nmhjklnm/gugu/issues/2702\n这里我们要做的一个重大的修改',
  }), '这里我们要做的一个重大的修改')
})

test('a lifecycle note supplies the title when no live summary exists', () => {
  const url = 'http://127.0.0.1:9/p/session-label-repro'
  const declared = {
    id: 'i', name: null, note: 'M4b-A landed; next is M4b-B — waiting for a human go', activity: 'debugging the launch failure',
    promptPreview: url, node: null, title: url, branch: `node/${url.replace(/\W+/g, '-')}`,
  }
  assert.equal(deriveTitle(declared), 'debugging the launch failure')
  assert.equal(deriveTitle({ ...declared, name: 'my-rename' }), 'my-rename', 'the human rename still wins')
  assert.equal(deriveTitle({ ...declared, activity: null }), 'M4b-A landed; next is M4b-B — waiting for a human go')
})

test('a long note is compacted into a bounded title', () => {
  const note = `${'declared: '.padEnd(80, 'x')}\nsecond line`
  const withLongNote = { id: 'i', note, activity: null }
  const withBlankNote = { id: 'i', note: '   \n  ', activity: 'stale title' }
  assert.equal(deriveTitle(withLongNote), withLongNote.note.slice(0, 59) + '…')
  assert.equal(deriveTitle(withBlankNote), 'stale title')
})

test('toSession derives one title while retaining the full record note', () => {
  const s = toSession(rec({ status: 'awaiting', proposal: 'nothing', note: 'parked on the human: which of the two shapes do you want?' }), 'done', 'online', 'debugging the launch failure')
  assert.equal(s.title, 'debugging the launch failure')
  assert.equal(s.note, 'parked on the human: which of the two shapes do you want?')
  assert.equal(s.label, 'x', 'the stable handle is untouched by a declaration')
})

test('toSession derives with liveness-gated activity; accessors are the precomputed fields', () => {
  const on = toSession(rec(), 'working', 'online', 'live summary')
  assert.equal(on.title, 'live summary')
  const off = toSession(rec(), 'offline', 'offline', 'stale summary')
  assert.notEqual(off.title, 'stale summary', 'a dead session never titles from a stale pane title')
  assert.equal(sessionLabel(on), on.label)
  assert.equal(sessionTitle(on), on.title)
})
