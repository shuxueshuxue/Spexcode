import { test } from 'node:test'
import assert from 'node:assert'
import { latestPerScenario, nodeEvalSummary } from './graph.js'
import { threadStamp } from './issues.js'

// Pins the board's eval-summary contract ([[graph-lean]]): the fold keeps the latest reading per scenario
// as the VERBATIM object — a filter, never a projection. Optional per-kind fields (the annotator's
// timelineBlob rides only video readings) must survive byte-for-byte: dropping one is a silent downstream
// degradation (the annotator decays to a bare player), which is exactly why this is a test and not a hope.

test('latest-per-scenario keeps newest-first order and one reading per scenario', () => {
  const rows = [
    { scenario: 'a', ts: '3' }, { scenario: 'b', ts: '2' }, { scenario: 'a', ts: '1' },
  ]
  assert.deepStrictEqual(latestPerScenario(rows), [{ scenario: 'a', ts: '3' }, { scenario: 'b', ts: '2' }])
})

test('retained readings are verbatim — every field survives, including video-only timelineBlob', () => {
  const video = {
    scenario: 'ui-flow', ts: '2026-07-02T10:00:00Z', fresh: true,
    verdict: { status: 'pass', note: 'smooth' },
    blob: 'abc123', blobKind: 'video', timelineBlob: 'tl-456', blobState: 'ok',
    evaluator: 'manual', codeSha: 'deadbeef', staleAxes: [],
  }
  const older = { ...video, ts: '2026-07-01T00:00:00Z', timelineBlob: 'tl-OLD' }
  const out = latestPerScenario([video, older, { scenario: 'other', ts: '1' }])
  assert.strictEqual(out.length, 2)
  assert.strictEqual(out[0], video)            // same reference: a filter cannot have projected anything
  assert.deepStrictEqual(out[0], video)        // and every field — timelineBlob included — is intact
  assert.strictEqual(out[0].timelineBlob, 'tl-456')
})

test('graph eval summary contains counts only while preserving every scenario state', () => {
  const summary = nodeEvalSummary(
    [{ name: 'pass' }, { name: 'fail' }, { name: 'stale' }, { name: 'blind' }],
    [
      { scenario: 'pass', fresh: true, verdict: { status: 'pass' } },
      { scenario: 'fail', fresh: true, verdict: { status: 'fail' } },
      { scenario: 'stale', fresh: false, verdict: { status: 'pass' } },
    ],
  )
  assert.deepStrictEqual(summary, { total: 4, pass: 1, fail: 1, stalePass: 1, staleFail: 0, empty: 1 })
  assert.equal(JSON.stringify(summary).includes('scenario'), false)
})

// Pins the board's write-visibility carrier ([[remark-substrate]]): the stamp is the ONE byte that moves
// when a thread is written, and [[graph-delta]] suppresses a broadcast whose bytes did not move — so a
// write this fold is blind to reaches an open viewer never, not late. It was blind to exactly one half:
// folded over the ISSUE read, which splits eval-remark tracks out ([[eval-issue-split]]), a scenario-hosted
// remark moved nothing and an open reading sat stale through a measured 30s. The fold's input is therefore
// the WHOLE store, and these cases are the two remark hosts plus the resolve/retract teeth.
const thread = (over: Record<string, unknown> = {}) => ({
  id: 'i1', store: 'local', concern: 'a taste concern', by: 'sess-1', status: 'open',
  nodes: [], created: '2026-07-25T10:00:00.000Z', body: '', replies: [], evidence: [], ...over,
} as any)
const reply = (over: Record<string, unknown> = {}) => ({ by: 'human', at: '2026-07-25T11:00:00.000Z', body: 'x', ...over })

test('the freshness stamp moves for a remark on EITHER host — issue thread and eval track alike', () => {
  const issue = thread()
  const track = thread({ id: 'eval-demo-s', concern: 'eval: demo · s' })
  const before = threadStamp([issue, track])

  // host 1: a remark on an ordinary issue thread
  assert.notStrictEqual(threadStamp([{ ...issue, replies: [reply({ rid: 'r1' })] }, track]), before)
  // host 2: a remark on the scenario's eval track — the half the ISSUE read splits out. This is the
  // regression: fold `mergedIssues` instead of the whole store and this assertion fails.
  assert.notStrictEqual(threadStamp([issue, { ...track, replies: [reply({ rid: 'r2' })] }]), before)
})

test('the stamp moves for every thread write, and only for a thread write', () => {
  const open = thread({ replies: [reply({ rid: 'r1' })] })
  const base = threadStamp([open])
  // resolve stamps the bit on the SAME reply — no count moves, so the activity instant must carry it
  assert.notStrictEqual(threadStamp([{ ...open, replies: [reply({ rid: 'r1', resolvedAt: '2026-07-25T12:00:00.000Z' })] }]), base)
  // retract removes the reply; close moves the lifecycle count
  assert.notStrictEqual(threadStamp([{ ...open, replies: [] }]), base)
  assert.notStrictEqual(threadStamp([{ ...open, status: 'landed' }]), base)
  // a quiet store is stable: an unwritten set must not churn the board (it would broadcast on nothing)
  assert.strictEqual(threadStamp([open]), base)
})
