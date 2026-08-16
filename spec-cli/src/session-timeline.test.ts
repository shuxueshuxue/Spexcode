import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendSent, currentHumanTurn, lastHumanSendVia, readTimeline, sentDispatchReceipt, settleSentDispatch, timelineEvents } from './session-timeline.js'
import { enqueue, pendingMessages } from './delivery-queue.js'
import { rvSock, stampRvSock } from './harness.js'
import { projectPublicRecordEntry, sessionArtifactPath, sessionRecordPath, sessionStoreDir, type RawRecord } from '@spexcode/spec-core'
import { cancelSessionWatch, composeSessionPrompt, listSessionWatches, markState, sendText, subscribeSessionWatch, withNoteReplyHint, withTerminalReplyHint } from './sessions.js'

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
const PARENT = 'timeline-parent-test'
let midSeq = 0
const sent = (from: string | null, replyVia?: 'note') =>
  ({ ts: '2026-07-16T00:00:00.000Z', kind: 'sent', mid: `mid-${++midSeq}`, text: 'msg', from, ...(replyVia ? { replyVia } : {}) })

function seedSessionRecord(home: string, id = ID, parent = ''): void {
  withHome(home, () => {
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), JSON.stringify({
      session_id: id,
      governed: true,
      worktree_path: process.cwd(),
      branch: 'node/timeline-via-test',
      node: 'session-timeline',
      title: 'timeline test',
      name: '',
      parent,
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

test('timeline observation keeps a pending launch on the frozen lifecycle until final publication', () => {
  const candidate = {
    session_id: 'pending-timeline',
    governed: true,
    worktree_path: process.cwd(),
    branch: 'main',
    node: null,
    title: null,
    name: null,
    status: 'idle',
    proposal: null,
    merges: 0,
    note: 'candidate note',
    sortkey: null,
    createdAt: 1,
    launch_readiness_pending: {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: 'active',
        proposal: null,
        note: 'original note',
        stopped: true,
        archived: false,
        cold_proof: null,
        adapter_recovery: null,
      },
    },
  } satisfies RawRecord
  const pending = projectPublicRecordEntry(candidate.session_id, { kind: 'ok', raw: candidate })
  assert.equal(pending.kind, 'ok')
  if (pending.kind === 'ok') {
    assert.deepEqual({ status: pending.raw.status, proposal: pending.raw.proposal, note: pending.raw.note, liveness: pending.liveness },
      { status: 'active', proposal: null, note: 'original note', liveness: 'offline' })
  }
  const published = projectPublicRecordEntry(candidate.session_id, { kind: 'ok', raw: { ...candidate, launch_readiness_pending: '' } })
  assert.equal(published.kind, 'ok')
  if (published.kind === 'ok') {
    assert.deepEqual({ status: published.raw.status, proposal: published.raw.proposal, note: published.raw.note, liveness: published.liveness },
      { status: 'idle', proposal: null, note: 'candidate note', liveness: null })
  }
  for (const [label, original] of [
    ['invalid lifecycle', { ...candidate.launch_readiness_pending.original, status: 'launching' }],
    ['invalid proposal', { ...candidate.launch_readiness_pending.original, proposal: 'deploy' }],
  ] as const) {
    const invalid = projectPublicRecordEntry(candidate.session_id, {
      kind: 'ok',
      raw: { ...candidate, launch_readiness_pending: { ...candidate.launch_readiness_pending, original } },
    })
    assert.equal(invalid.kind, 'corrupt', `${label} is withheld from timeline observation`)
    if (invalid.kind === 'corrupt') assert.equal(invalid.liveness, 'unknown')
  }
})

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

test('a parent watch skips working while a manual watch keeps the full state feed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home, PARENT)
  seedSessionRecord(home, ID, PARENT)
  await withHomeAsync(home, async () => {
    assert.deepEqual(await subscribeSessionWatch(PARENT, [ID], 'parent'), { watched: [ID] })
    assert.deepEqual(listSessionWatches(PARENT).map((watch) => watch.target), [ID])
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 0, 'parent installation does not announce an already-working child')
    assert.equal(markState('awaiting', { proposal: 'merge', note: 'ready for review', sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const messages = timelineEvents(PARENT).filter((event) => event.kind === 'sent')
    assert.equal(messages.length, 1, 'a non-working child transition wakes its parent through send')
    const changed = messages.at(-1)
    assert.equal(changed?.kind === 'sent' && changed.from, ID)
    assert.match(changed?.kind === 'sent' ? changed.text : '', /review/)
    assert.equal(markState('active', { sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 1, 'parent supervision skips a child returning to working')

    assert.deepEqual(await subscribeSessionWatch(PARENT, [ID]), { watched: [ID] })
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 2, 'manual installation deliberately includes the current working state')
    assert.equal(markState('asking', { note: 'need input', sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 3, 'overlapping sources still deliver one message')
    assert.equal(markState('active', { sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 4, 'manual supervision keeps working transitions')

    assert.equal(cancelSessionWatch(PARENT, [ID]), 1)
    assert.deepEqual(listSessionWatches(PARENT).map((watch) => watch.target), [ID], 'cancelling manual watch leaves parent supervision intact')
    assert.equal(markState('asking', { note: 'need input', sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 5, 'parent supervision continues for non-working declarations')
    assert.equal(markState('active', { sessionId: ID }), true)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(timelineEvents(PARENT).filter((event) => event.kind === 'sent').length, 5, 'parent supervision still skips working after manual cancellation')
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

test('currentHumanTurn is reconstructed from the latest durable human send', () => {
  const first = sent(null)
  const second = sent('aaaa1111-2222-3333-4444-555555555555')
  const third = sent(null)
  const home = seedTimeline([first, second, third])
  withHome(home, () => assert.deepEqual(currentHumanTurn(ID), { token: third.mid, acceptedAt: third.ts }))
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

test('composeSessionPrompt guarantees no harness is handed a prompt that begins with a hyphen', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-optionsafe-'))
  await withHomeAsync(home, async () => {
    // the shape a human actually produces: a pasted browser-console line. Downstream that leading `-` is the
    // difference between a prompt and an argument — claude's commander answers `unknown option`, opencode's
    // yargs drops it, pi's parser has no end-of-options branch at all — so the guarantee is made ONCE here
    // rather than as an escape per adapter plus a refusal for the harness that has none.
    const pasted = '-home-app/api/uploads:1  Failed to load resource: 413 (Payload Too Large)'
    for (const harness of ['claude', 'codex', 'opencode', 'pi', 'claude-headless', 'codex-headless', 'opencode-headless', 'pi-headless']) {
      const composed = await composeSessionPrompt(pasted, { session: ID, harness })
      assert.ok(!composed.text.startsWith('-'), `${harness} was handed an option-shaped prompt: ${composed.text.slice(0, 20)}`)
      assert.ok(composed.text.includes(pasted), `${harness} lost the human's own words`)
    }

    // the launch scripts also discriminate their resume/continue markers by comparing $1 to a literal flag,
    // so a prompt that IS such a marker must not be able to impersonate one.
    for (const marker of ['--resume', '--continue']) {
      const composed = await composeSessionPrompt(marker, { session: ID, harness: 'codex' })
      assert.notEqual(composed.text, marker, `a raw ${marker} prompt could be read as a resume marker`)
      assert.ok(composed.text.includes(marker))
    }

    // anything not starting with `-` is untouched, byte for byte.
    assert.deepEqual(await composeSessionPrompt('fix the login bug', { session: ID, harness: 'claude' }), { text: 'fix the login bug' })
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
  assert.ok(out.includes('answered exploratory question'), out)
  assert.ok(out.includes('reply transport'), out)
  assert.ok(out.includes('even when the message says to use no tools'), out)
  assert.ok(out.includes('FINAL action'), out)
  assert.ok(out.includes('PER-MESSAGE'), out)
  assert.doesNotMatch(out, /LIVE ARTIFACT HANDOFF|spex session files add|spex session web add/)
})

test('withTerminalReplyHint: keeps the message and explicitly countermands the note-reply instruction', () => {
  const out = withTerminalReplyHint('back at my desk now')
  assert.ok(out.startsWith('back at my desk now'), out)
  assert.ok(out.includes('terminal-attached'), out)
  // the countermand is explicit — it names the --note habit it is switching off
  assert.ok(out.includes('--note'), out)
  assert.ok(out.includes('no longer apply'), out)
  assert.doesNotMatch(out, /LIVE ARTIFACT HANDOFF|spex session files add|spex session web add/)
})

// ---- the append IS the delivery ([[dispatch]]) ----

test('appendSent stamps a unique mid on each durable line', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  withHome(home, () => {
    const first = appendSent(ID, 'hello', null)
    const second = appendSent(ID, 'again', 'sender-1', 'note')
    assert.notEqual(first.mid, second.mid)
    const evs = timelineEvents(ID)
    assert.deepEqual(evs.map((e) => e.kind === 'sent' ? [e.mid, e.text, e.from, e.replyVia ?? null] : [e.kind]), [
      [first.mid, 'hello', null, null],
      [second.mid, 'again', 'sender-1', 'note'],
    ])
  })
})

test('a dispatch receipt is durable for replay but absent from public timeline events', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  withHome(home, () => {
    const receipt = { operation: 'merge' as const, requestDigest: 'a'.repeat(64), payloadHash: 'b'.repeat(64) }
    const appended = appendSent(ID, 'merge intent', null, undefined, receipt)
    assert.deepEqual(sentDispatchReceipt(ID, 'merge', receipt.requestDigest), {
      mid: appended.mid, payloadHash: receipt.payloadHash, delivery: null, delivered: false,
    })
    const internalRead = timelineEvents(ID)
    assert.equal(internalRead.length, 1)
    assert.ok(!('dispatchReceipt' in internalRead[0]))
    const publicRead = readTimeline(ID)
    assert.ok(publicRead)
    assert.ok(!('dispatchReceipt' in publicRead.events[0]))
  })
})

test('a recoverable dispatch receipt settles privately without displacing the public tail', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  withHome(home, () => {
    const receipt = {
      operation: 'merge' as const,
      requestDigest: 'c'.repeat(64),
      payloadHash: 'd'.repeat(64),
      delivery: { text: 'transport merge intent', from: null },
    }
    const appended = appendSent(ID, 'merge intent', null, undefined, receipt)
    assert.deepEqual(sentDispatchReceipt(ID, 'merge', receipt.requestDigest), {
      mid: appended.mid, payloadHash: receipt.payloadHash, delivery: receipt.delivery, delivered: false,
    })
    settleSentDispatch(ID, appended.mid)
    assert.deepEqual(sentDispatchReceipt(ID, 'merge', receipt.requestDigest), {
      mid: appended.mid, payloadHash: receipt.payloadHash, delivery: receipt.delivery, delivered: true,
    })
    assert.deepEqual(timelineEvents(ID).map((event) => event.kind), ['sent'])
    assert.deepEqual(readTimeline(ID, 1)?.events.map((event) => event.kind), ['sent'])
  })
})

test('new appends rotate immutable numbered segments while the read surface preserves event order', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  const previous = process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
  process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = '1024'
  try {
    withHome(home, () => {
      appendSent(ID, 'a'.repeat(900), null)
      appendSent(ID, 'b'.repeat(900), null)
      appendSent(ID, 'c'.repeat(900), null)
      const dir = join(sessionStoreDir(ID), 'timeline')
      assert.deepEqual(readdirSync(dir).sort(), ['000000000001.ndjson', '000000000002.ndjson', '000000000003.ndjson'])
      assert.deepEqual(timelineEvents(ID).map((event) => event.kind === 'sent' ? event.text[0] : '?'), ['a', 'b', 'c'])
      assert.deepEqual(readTimeline(ID, 2)?.events.map((event) => event.kind === 'sent' ? event.text[0] : '?'), ['b', 'c'])
    })
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
    else process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = previous
  }
})

test('tail reads across a large set of sealed segments without losing order', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  const previous = process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
  process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = '1024'
  try {
    withHome(home, () => {
      for (let i = 0; i < 128; i++) appendSent(ID, `${String(i).padStart(3, '0')}:${'x'.repeat(900)}`, null)
      const dir = join(sessionStoreDir(ID), 'timeline')
      assert.equal(readdirSync(dir).length, 128, 'each oversize event seals its own immutable segment')
      const tail = readTimeline(ID, 50)?.events ?? []
      assert.equal(tail.length, 50)
      assert.deepEqual(tail.map((event) => event.kind === 'sent' ? event.text.slice(0, 3) : '?'),
        Array.from({ length: 50 }, (_, i) => String(i + 78).padStart(3, '0')))
    })
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
    else process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = previous
  }
})

test('tail reads 500 events from 1,024 sealed segments in event order', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  const previous = process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
  process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = '1024'
  try {
    withHome(home, () => {
      for (let i = 0; i < 1024; i++) appendSent(ID, `${String(i).padStart(4, '0')}:${'x'.repeat(1800)}`, null)
      const dir = join(sessionStoreDir(ID), 'timeline')
      assert.equal(readdirSync(dir).length, 1024)
      const tail = readTimeline(ID, 500)?.events ?? []
      assert.equal(tail.length, 500)
      assert.deepEqual(tail.map((event) => event.kind === 'sent' ? event.text.slice(0, 4) : '?'),
        Array.from({ length: 500 }, (_, i) => String(i + 524).padStart(4, '0')))
    })
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES
    else process.env.SPEXCODE_TIMELINE_SEGMENT_BYTES = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a send the adapter cannot take still succeeds, and the message stays OWED', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  await withHomeAsync(home, async () => {
    // no rendezvous socket, no tmux window: the handover cannot happen. Acceptance is the write, so the caller
    // is told the truth — the bytes ARE in the log — and the debt is what carries the retry.
    const r = await sendText(ID, 'the insert will fail')
    assert.deepEqual(r, { ok: true })
    const evs = timelineEvents(ID).filter((e) => e.kind === 'sent')
    assert.equal(evs.length, 1)
    assert.equal(evs[0].kind === 'sent' && evs[0].text, 'the insert will fail')
    assert.equal(pendingMessages(ID).length, 1, 'nothing was handed over, so the session still owes it')
  })
})

test('a live agent with a proven-dead rendezvous transport is stranded before enqueue', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-stranded-send-'))
  seedSessionRecord(home)
  await withHomeAsync(home, async () => {
    const sock = stampRvSock(ID)
    const listener = createServer()
    await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(sock, resolve) })
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    rmSync(sock, { force: true }) // only the socket created by this fixture

    const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    assert.ok(agent.pid)
    writeFileSync(sessionArtifactPath(ID, 'agent.pid'), `${agent.pid}\n`)
    enqueue(ID, { mid: 'already-owed', text: 'older debt', from: null })
    try {
      const result = await sendText(ID, 'must not join the abandoned queue')
      assert.equal(result.ok, false)
      assert.doesNotMatch(result.error ?? '', /\bsent\b/)
      assert.match(result.error ?? '', /stranded: its launch-time rendezvous listener is absent or refusing connections/)
      assert.match(result.error ?? '', /1 queued message is waiting/)
      assert.match(result.error ?? '', new RegExp(`spex session send ${ID} --keys`))
      assert.equal(timelineEvents(ID).filter((event) => event.kind === 'sent').length, 0)
      assert.deepEqual(pendingMessages(ID).map((message) => message.mid), ['already-owed'])
    } finally {
      agent.kill()
      await once(agent, 'exit')
    }
  })
})

// THE regression this module exists to prevent. A landed handover must SETTLE the debt: when it did not, every
// message was replayed to the agent at its next turn boundary on top of arriving normally — delivered twice.
test('an accepted adapter insert settles the debt, so nothing is ever handed over twice', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  await withHomeAsync(home, async () => {
    const sock = rvSock(ID)
    rmSync(sock, { force: true })
    let received = ''
    let resolveReceived!: () => void
    const receivedReply = new Promise<void>((resolve) => { resolveReceived = resolve })
    const server = createServer((socket) => socket.on('data', (chunk) => {
      received += chunk
      resolveReceived()
    }))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(sock, resolve)
    })
    try {
      assert.deepEqual(await sendText(ID, 'the listener took the insert'), { ok: true })
      await receivedReply
      assert.match(received, /the listener took the insert/)
      assert.deepEqual(pendingMessages(ID), [], 'a landed insert owes nothing further')
      assert.equal(timelineEvents(ID).filter((e) => e.kind === 'sent').length, 1, 'and the log still records it once')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(sock, { force: true })
    }
  })
})

test('a RETIRED session still receives: a message it cannot act on must still leave a trace', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  seedSessionRecord(home)
  await withHomeAsync(home, async () => {
    const gone = join(home, 'worktree-that-was-removed')
    const record = JSON.parse(readFileSync(sessionRecordPath(ID), 'utf8'))
    writeFileSync(sessionRecordPath(ID), JSON.stringify({ ...record, worktree_path: gone }, null, 2) + '\n')
    // the lifecycle axis is still refused — it cannot work, be marked active, or be relaunched
    assert.throws(() => markState('active', { sessionId: ID }), /is retired/)
    // ...but the log is a record of something that HAPPENED, not a claim the session can act
    const r = await sendText(ID, 'are you still there?')
    assert.deepEqual(r, { ok: true })
    assert.equal(timelineEvents(ID).filter((e) => e.kind === 'sent').length, 1)
  })
})

test('an unknown session id is the loud failure, and it records nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-timeline-'))
  await withHomeAsync(home, async () => {
    const r = await sendText('no-such-session', 'hello?')
    assert.equal(r.ok, false)
    assert.match(r.error || '', /no session record/)
    assert.deepEqual(timelineEvents('no-such-session'), [])
  })
})

test('the read surface does NOT fold repeated status lines — history is append-only and X→X is a read-side call', () => {
  // duplicates already exist in live logs (stray serve observers re-recorded real moves before the observer
  // was deleted). The read must hand them over as they are; deciding what counts as a MOVE belongs to the
  // reader's edge test ([[session-cursors]] unreadSince), not to a lossy read.
  const home = seedTimeline([
    { ts: '2026-07-16T00:00:00.000Z', kind: 'status', status: 'awaiting', proposal: 'merge', note: 'ready' },
    { ts: '2026-07-16T00:00:00.100Z', kind: 'status', status: 'awaiting', proposal: 'merge', note: 'ready' },
  ])
  seedSessionRecord(home)
  withHome(home, () => assert.equal(readTimeline(ID)?.events.length, 2))
})
