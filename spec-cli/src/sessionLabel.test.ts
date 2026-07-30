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
  status: 'active', proposal: null, merges: 0, note: null, sortKey: null, createdAt: 1,
  harness: 'claude', harnessSessionId: null, stopped: false, archived: false, launcher: null, launchCmd: null, launchOwner: null,
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

test('headline precedence: name > note > activity > promptPreview > node > …', () => {
  const parts = { id: 'i', name: null, note: null, node: 'nd', title: 't', branch: 'b', activity: 'doing X', promptPreview: 'the ask' }
  assert.equal(deriveHeadline(parts), 'doing X')
  assert.equal(deriveHeadline({ ...parts, activity: null }), 'the ask')
  assert.equal(deriveHeadline({ ...parts, name: 'N' }), 'N', 'a user rename wins over the live activity')
  assert.equal(deriveHeadline({ ...parts, activity: null, promptPreview: null }), 'nd')
})

// The defect this precedence exists for ([[session-label]]): a byproduct outranking the session's own current
// word. Both reported shapes are ONE ordering — a frozen pane title, and a URL-shaped launch ask that makes
// every lower cell a copy of the same uninformative string.
test('a standing declaration outranks the byproducts, and a rename still outranks it', () => {
  const url = 'http://127.0.0.1:9/p/session-label-repro'
  const declared = {
    id: 'i', name: null, note: 'M4b-A landed; next is M4b-B — waiting for a human go', activity: 'debugging the launch failure',
    promptPreview: url, node: null, title: url, branch: `node/${url.replace(/\W+/g, '-')}`,
  }
  assert.equal(deriveHeadline(declared), 'M4b-A landed; next is M4b-B — waiting for a human go')
  assert.equal(deriveHeadline({ ...declared, name: 'my-rename' }), 'my-rename', 'the human rename still wins')
  assert.equal(deriveHeadline({ ...declared, note: null }), 'debugging the launch failure', 'with nothing declared the live self-summary is still the best line')
  assert.equal(deriveHeadline({ ...declared, note: null, activity: null }), url, 'and below it the launch ask, however uninformative')
})

test('a long note enters the headline as one bounded line, and blank prose is not a headline', () => {
  const note = `${'declared: '.padEnd(80, 'x')}\nsecond line`
  const headline = deriveHeadline({ id: 'i', note, activity: 'stale title' })
  assert.equal(headline.split('\n').length, 1, 'a headline is ONE line')
  assert.equal(headline.length, 60)
  assert.ok(headline.endsWith('…'))
  assert.equal(deriveHeadline({ id: 'i', note: '   \n  ', activity: 'stale title' }), 'stale title', 'whitespace says nothing')
})

test('toSession headlines the record note over a live pane title', () => {
  const s = toSession(rec({ status: 'awaiting', proposal: 'nothing', note: 'parked on the human: which of the two shapes do you want?' }), 'done', 'online', 'debugging the launch failure')
  assert.equal(s.headline, 'parked on the human: which of the two shapes do you want?')
  assert.equal(s.activity, 'debugging the launch failure', 'the pane title still rides the wire — it is only outranked')
  assert.equal(s.label, 'x', 'the stable handle is untouched by a declaration')
})

test('toSession derives with liveness-gated activity; accessors are the precomputed fields', () => {
  const on = toSession(rec(), 'working', 'online', 'live summary')
  assert.equal(on.headline, 'live summary')
  const off = toSession(rec(), 'offline', 'offline', 'stale summary')
  assert.notEqual(off.headline, 'stale summary', 'a dead session never headlines a stale pane title')
  assert.equal(sessionLabel(on), on.label)
  assert.equal(sessionHeadline(on), on.headline)
})
