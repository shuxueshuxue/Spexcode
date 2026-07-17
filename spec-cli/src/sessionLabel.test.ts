import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toSession, deriveLabel, deriveHeadline, sessionLabel, sessionHeadline } from './sessions.js'
import type { SessRec } from './sessions.js'

// Pins the session-label contract ([[session-label]]): display strings are DERIVED in exactly one place
// and the bare parts (rename `name`, prompt-truncation `title`) never ride the wire at the top level. The
// wire-shape assertions are the enforcement half — a future field "helpfully" re-exposed at the top level
// fails here before any surface can grow a bypass chain on it.

const rec = (over: Partial<SessRec> = {}): SessRec => ({
  session: 'sess-1', governed: true, worktreePath: '/wt/x', branch: 'node/x-1', node: 'x',
  title: 'seven word prompt truncation title here', name: null, parent: null,
  status: 'active', proposal: null, merges: 0, note: null, sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, launcher: null, launchCmd: null, mode: 'interactive',
  ...over,
})

test('wire shape: no top-level title/name — only label/headline + raw parts', () => {
  const s = toSession(rec({ name: 'My Rename' }), 'working', 'online', '✳ ignored-here')
  assert.equal('title' in s, false, 'bare title must not ride the wire')
  assert.equal('name' in s, false, 'bare name must not ride the wire')
  assert.equal(s.raw.name, 'My Rename')
  assert.equal(s.raw.title, 'seven word prompt truncation title here')
  assert.equal(typeof s.label, 'string')
  assert.equal(typeof s.headline, 'string')
})

test('label precedence: name > node > title > branch > id', () => {
  assert.equal(deriveLabel({ id: 'i', name: 'N', node: 'nd', title: 't', branch: 'b' }), 'N')
  assert.equal(deriveLabel({ id: 'i', name: null, node: 'nd', title: 't', branch: 'b' }), 'nd')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: 't', branch: 'b' }), 't')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: null, branch: 'b' }), 'b')
  assert.equal(deriveLabel({ id: 'i', name: null, node: null, title: null, branch: null }), 'i')
})

test('headline precedence: name > activity > promptPreview > node > …', () => {
  const parts = { id: 'i', name: null, node: 'nd', title: 't', branch: 'b', activity: 'doing X', promptPreview: 'the ask' }
  assert.equal(deriveHeadline(parts), 'doing X')
  assert.equal(deriveHeadline({ ...parts, activity: null }), 'the ask')
  assert.equal(deriveHeadline({ ...parts, name: 'N' }), 'N', 'a user rename wins over the live activity')
  assert.equal(deriveHeadline({ ...parts, activity: null, promptPreview: null }), 'nd')
})

test('toSession derives with liveness-gated activity; accessors are the precomputed fields', () => {
  const on = toSession(rec(), 'working', 'online', 'live summary')
  assert.equal(on.headline, 'live summary')
  const off = toSession(rec(), 'offline', 'offline', 'stale summary')
  assert.notEqual(off.headline, 'stale summary', 'a dead session never headlines a stale pane title')
  assert.equal(sessionLabel(on), on.label)
  assert.equal(sessionHeadline(on), on.headline)
})
