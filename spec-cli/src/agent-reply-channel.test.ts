import { test } from 'node:test'
import assert from 'node:assert/strict'

import { withSenderHint } from './sessions.js'

// withSenderHint is the WHOLE feature: `spex session send` wraps the delivered message with a sender stamp +
// a runnable reply command. These pin the three cases the send command produces — agent→agent (label + id),
// a sender with no label (id only), and a human in a plain shell (no session → bare message, no reply loop).
const FULL = 'aaaa1111-2222-3333-4444-555555555555'

test('withSenderHint: agent→agent stamps the sender label + FULL id and a runnable reply command', () => {
  const out = withSenderHint('finish the merge', { id: FULL, label: 'launch' })
  // the original message survives, unmodified, at the top
  assert.ok(out.startsWith('finish the merge'), out)
  // names WHO sent it: label then the full id (never a prefix — the reply must hit exactly one session)
  assert.ok(out.includes(`— from launch (${FULL})`), out)
  // the reply rides the SAME send, addressed at the sender's FULL id
  assert.ok(out.includes(`To reply: spex session send ${FULL} "<your reply>"`), out)
})

test('withSenderHint: a sender with no label is named by full id alone — no empty parens', () => {
  const out = withSenderHint('ping', { id: FULL, label: null })
  assert.ok(out.includes(`— from ${FULL}.`), out)
  assert.ok(!out.includes('()'), out)
  assert.ok(out.includes(`spex session send ${FULL} "<your reply>"`), out)
})

test('withSenderHint: a human in a plain shell (no session) gets the bare message — no hint, no reply loop', () => {
  assert.equal(withSenderHint('just a heads up', null), 'just a heads up')
})

test('withSenderHint: a multi-line message is preserved; the hint is appended below it', () => {
  const msg = 'line one\nline two'
  const out = withSenderHint(msg, { id: FULL, label: 'graph' })
  assert.ok(out.startsWith(msg), out)
  assert.ok(out.indexOf('— from graph') > out.indexOf('line two'), out)
})
