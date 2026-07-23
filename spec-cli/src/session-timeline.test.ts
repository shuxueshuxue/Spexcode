import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lastHumanSendVia, readTimeline } from './session-timeline.js'
import { sessionRecordPath, sessionStoreDir } from './layout.js'
import { composeSessionPrompt, markState, withNoteReplyHint, withTerminalReplyHint } from './sessions.js'

// The reply-channel signal must be SYMMETRIC (the [[session-timeline]] write surface): the phone's
// explicit note-sends and every headless target carry the note insert, and the first terminal send after
// them carries the counter-insert.
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

async function withHomeAsync<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return await fn() } finally {
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

function seedSessionRecord(home: string): void {
  withHome(home, () => {
    mkdirSync(sessionStoreDir(ID), { recursive: true })
    writeFileSync(sessionRecordPath(ID), JSON.stringify({
      session_id: ID,
      governed: true,
      worktree_path: process.cwd(),
      branch: 'node/timeline-via-test',
      node: 'session-timeline',
      title: 'timeline test',
      name: '',
      parent: '',
      status: 'active',
      proposal: '',
      merges: 0,
      note: '',
      sortkey: '',
      createdAt: 1,
      harness: 'opencode',
      harness_session_id: '',
      launcher: 'opencode',
      launch_cmd: 'opencode',
      launch_owner: '',
    }, null, 2) + '\n')
  })
}

test('a declaration note remains in the timeline after a later status replaces the current record', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  withHome(home, () => {
    assert.equal(markState('awaiting', { proposal: 'nothing', note: 'CELL_note=17', sessionId: ID }), true)
    assert.equal(markState('active', { sessionId: ID }), true)

    const timeline = readTimeline(ID)
    assert.ok(timeline)
    assert.deepEqual(timeline.events.map((event) => event.kind === 'status'
      ? [event.status, event.proposal, event.note]
      : [event.kind]), [
      ['awaiting', 'nothing', 'CELL_note=17'],
      ['active', null, null],
    ])
  })
})

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

test('composeSessionPrompt owns headless defaults, explicit overrides, and final launch ordering', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  await withHomeAsync(home, async () => {
    const headless = await composeSessionPrompt('answer this', { session: ID, harness: 'pi-headless' }, {
      suffix: '\n\nThe spec node is at /tmp/spec.md.',
    })
    assert.equal(headless.replyVia, 'note')
    assert.ok(headless.text.startsWith('answer this\n\nThe spec node is at /tmp/spec.md.'), headless.text)
    assert.ok(headless.text.indexOf('/tmp/spec.md') < headless.text.indexOf('REQUIRED REPLY TRANSPORT'), headless.text)

    const interactive = await composeSessionPrompt('answer normally', { session: ID, harness: 'claude' })
    assert.deepEqual(interactive, { text: 'answer normally' })

    const explicit = await composeSessionPrompt('put this in note', { session: ID, harness: 'claude' }, { replyVia: 'note' })
    assert.equal(explicit.replyVia, 'note')
    assert.ok(explicit.text.includes('REQUIRED REPLY TRANSPORT'), explicit.text)
  })
})

test('composeSessionPrompt owns the one-shot note-to-terminal counter-insert', async () => {
  const home = seedTimeline([sent(null, 'note')])
  await withHomeAsync(home, async () => {
    const composed = await composeSessionPrompt('back at desk', { session: ID, harness: 'claude' })
    assert.equal(composed.replyVia, undefined)
    assert.ok(composed.text.includes('terminal-attached client'), composed.text)
  })
})

test('withNoteReplyHint: makes the note declaration required reply transport even for no-tools prompts', () => {
  const out = withNoteReplyHint('how is the merge going?')
  assert.ok(out.startsWith('how is the merge going?'), out)
  assert.ok(out.includes('spex session ask --note'), out)
  assert.ok(out.includes('reply transport'), out)
  assert.ok(out.includes('even when the message says to use no tools'), out)
  assert.ok(out.includes('FINAL action'), out)
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
