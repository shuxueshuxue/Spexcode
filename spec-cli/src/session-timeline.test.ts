import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lastHumanSendVia } from './session-timeline.js'
import { sessionStoreDir } from './layout.js'
import { withNoteReplyHint, withTerminalReplyHint } from './sessions.js'

// The reply-channel signal must be SYMMETRIC (the [[session-timeline]] write surface): the phone's
// note-sends carry an opt-in insert, and the first terminal send after them carries the counter-insert.
// These pin the transition detector (lastHumanSendVia over the durable sent log) and the two phrases'
// load-bearing claims — without the counter-signal, an agent that note-replied keeps note-replying from
// context inertia after the human is back at a terminal (the sticky-note failure).

function withHome<T>(home: string, fn: () => T): T {
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return fn() } finally {
    if (prev === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = prev
  }
}

// seed via the REAL layout helper (the store nests under a per-project encoding — a hand-built
// `<home>/sessions/<id>` path silently misses it and every read answers empty)
function seedTimeline(events: object[]): string {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  withHome(home, () => {
    const dir = sessionStoreDir('timeline-via-test')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'timeline.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  })
  return home
}

const ID = 'timeline-via-test'
const sent = (from: string | null, replyVia?: 'note') =>
  ({ ts: '2026-07-16T00:00:00.000Z', kind: 'sent', text: 'msg', from, ...(replyVia ? { replyVia } : {}) })

test('lastHumanSendVia: no timeline at all → null (a fresh session never gets the counter-insert)', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  withHome(home, () => assert.equal(lastHumanSendVia('no-such-session'), null))
})

test('lastHumanSendVia: last human send was a note-send → note (the next terminal send is the transition)', () => {
  const home = seedTimeline([sent(null), sent(null, 'note')])
  withHome(home, () => assert.equal(lastHumanSendVia(ID), 'note'))
})

test('lastHumanSendVia: a plain human send after the note-send clears it — the counter-insert fires ONCE', () => {
  const home = seedTimeline([sent(null, 'note'), sent(null)])
  withHome(home, () => assert.equal(lastHumanSendVia(ID), null))
})

test('lastHumanSendVia: agent-to-agent sends neither set nor clear the human channel', () => {
  // an agent message lands between the phone send and the terminal send — the transition must survive it
  const home = seedTimeline([sent(null, 'note'), sent('aaaa1111-2222-3333-4444-555555555555')])
  withHome(home, () => assert.equal(lastHumanSendVia(ID), 'note'))
})

test('lastHumanSendVia: status events are ignored — only sent events carry a channel', () => {
  const home = seedTimeline([sent(null, 'note'), { ts: '2026-07-16T00:00:01.000Z', kind: 'status', status: 'active', proposal: null, note: null }])
  withHome(home, () => assert.equal(lastHumanSendVia(ID), 'note'))
})

test('withNoteReplyHint: keeps the message, asks for the reply in --note, and declares itself PER-MESSAGE', () => {
  const out = withNoteReplyHint('how is the merge going?')
  assert.ok(out.startsWith('how is the merge going?'), out)
  assert.ok(out.includes('--note'), out)
  assert.ok(out.includes('PER-MESSAGE'), out)
})

test('withTerminalReplyHint: keeps the message and explicitly countermands the note-reply instruction', () => {
  const out = withTerminalReplyHint('back at my desk now')
  assert.ok(out.startsWith('back at my desk now'), out)
  assert.ok(out.includes('terminal-attached'), out)
  // the countermand is explicit — it names the --note habit it is switching off
  assert.ok(out.includes('--note'), out)
  assert.ok(out.includes('no longer apply'), out)
})
