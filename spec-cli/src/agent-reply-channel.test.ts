import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withSenderHint, sessionHeadline } from './sessions.js'

// withSenderHint is the WHOLE feature: `spex session send` wraps the delivered message with a sender stamp +
// a runnable reply command. These pin the cases the send command produces — agent→agent (headline + id,
// delimited as a session title), a sender named only by its bare id, and a human in a plain shell (no
// session → bare message, no reply loop). sessionHeadline (below) is the name source the footer now uses.
const FULL = 'aaaa1111-2222-3333-4444-555555555555'

test('withSenderHint: agent→agent stamps the sender headline DELIMITED as a session title + FULL id + reply', () => {
  const out = withSenderHint('finish the merge', { id: FULL, label: 'launch' })
  // the original message survives, unmodified, at the top
  assert.ok(out.startsWith('finish the merge'), out)
  // names WHO sent it: the headline wrapped `session "<headline>" (<id>)` so it reads AS a title, not prose
  assert.ok(out.includes(`— from session "launch" (${FULL})`), out)
  // the reply rides the SAME send, addressed at the sender's FULL id (never a prefix — must hit one session)
  assert.ok(out.includes(`To reply: spex session send ${FULL} "<your reply>"`), out)
})

test('withSenderHint: a sender named only by its bare id is `session <id>` — no empty quotes/parens', () => {
  const out = withSenderHint('ping', { id: FULL, label: null })
  assert.ok(out.includes(`— from session ${FULL}.`), out)
  assert.ok(!out.includes('()'), out)
  assert.ok(!out.includes('""'), out)
  assert.ok(out.includes(`spex session send ${FULL} "<your reply>"`), out)
})

test('withSenderHint: a label equal to the id is not double-stamped — `session <id>`, no redundant quotes', () => {
  const out = withSenderHint('ping', { id: FULL, label: FULL })
  assert.ok(out.includes(`— from session ${FULL}.`), out)
  assert.ok(!out.includes(`"${FULL}"`), out)
})

test('withSenderHint: a human in a plain shell (no session) gets the bare message — no hint, no reply loop', () => {
  assert.equal(withSenderHint('just a heads up', null), 'just a heads up')
})

test('withSenderHint: a multi-line message is preserved; the hint is appended below it', () => {
  const msg = 'line one\nline two'
  const out = withSenderHint(msg, { id: FULL, label: 'graph' })
  assert.ok(out.startsWith(msg), out)
  assert.ok(out.indexOf('— from session "graph"') > out.indexOf('line two'), out)
})

// sessionHeadline is the unified cross-surface title the footer (and watch greeting) now use — the SAME chain
// the board card shows: a chosen NAME wins, else the live self-summary `activity`, else a fuller promptPreview,
// else node/title/branch/id. The fix it encodes: a session with no name but a live activity is named by that
// activity (what the board shows), NOT by the bare 7-word prompt `title` that the old sessionLabel stopped at.
const sess = (o: Record<string, unknown>) => ({ name: null, activity: null, promptPreview: null, node: null, title: null, branch: null, id: 'idfallback', ...o }) as any

test('sessionHeadline: a chosen name wins over everything', () => {
  assert.equal(sessionHeadline(sess({ name: 'my-rename', activity: 'doing x', title: 'do a thing now please' })), 'my-rename')
})

test('sessionHeadline: with no name, the LIVE activity (Claude Code summary) wins over the prompt title — the fix', () => {
  assert.equal(sessionHeadline(sess({ activity: 'merging round-2 into main', promptPreview: 'fix the session title chain', title: 'fix the session' })), 'merging round-2 into main')
})

test('sessionHeadline: with no name or activity, the fuller promptPreview beats the 7-word title', () => {
  assert.equal(sessionHeadline(sess({ promptPreview: 'support semantic search inside SpexCode for code-as-spec', title: 'support semantic search inside SpexCode for' })), 'support semantic search inside SpexCode for code-as-spec')
})

test('sessionHeadline: falls through node → title → branch → id when nothing richer exists', () => {
  assert.equal(sessionHeadline(sess({ node: 'main-guard' })), 'main-guard')
  assert.equal(sessionHeadline(sess({ title: 'a title' })), 'a title')
  assert.equal(sessionHeadline(sess({ branch: 'node/x' })), 'node/x')
  assert.equal(sessionHeadline(sess({})), 'idfallback')
})
