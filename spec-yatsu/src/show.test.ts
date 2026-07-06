import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatTimeline } from './cli.js'
import type { EvalTimeline, EvalEntry } from './evaltab.js'

// a reading with sensible defaults; override per case.
function reading(over: Partial<EvalEntry>): EvalEntry {
  return {
    scenario: 's', expected: '', codeSha: 'abcdef0123456789', blob: null, evaluator: 'manual@1',
    ts: '2026-06-22T00:00:00.000Z', fresh: true, staleAxes: [], blobState: 'none', ...over,
  }
}
const timeline = (readings: EvalEntry[], over: Partial<EvalTimeline> = {}): EvalTimeline =>
  ({ node: 'n', hasYatsu: true, scenarios: [], retractions: [], dangling: [], readings, ...over })

// ---- formatTimeline: the human face of the SAME EvalTimeline --json emits verbatim ----

test('formatTimeline: empty states stay distinct by hasYatsu', () => {
  assert.match(formatTimeline(timeline([], { hasYatsu: false })), /declares no scenarios \(no yatsu\.md\)/)
  assert.match(formatTimeline(timeline([])), /scenarios but no reading yet/)
})

test('formatTimeline: renders readings in given (newest-first) order, one row each', () => {
  const out = formatTimeline(timeline([
    reading({ scenario: 'newest' }),
    reading({ scenario: 'oldest' }),
  ]))
  assert.match(out, /2 reading\(s\), newest first/)
  assert.ok(out.indexOf('newest') < out.indexOf('oldest'), 'array order is preserved (newest leads)')
})

test('formatTimeline: a fresh reading shows the current badge + short codeSha', () => {
  const out = formatTimeline(timeline([reading({ fresh: true, codeSha: 'abcdef0123456789' })]))
  assert.match(out, /✓ current/)
  assert.match(out, /abcdef0/)          // 7-char short sha
  assert.doesNotMatch(out, /abcdef0123456789/) // not the full sha
})

test('formatTimeline: a stale reading names the moved axes', () => {
  const out = formatTimeline(timeline([reading({ fresh: false, staleAxes: ['code', 'scenario'] })]))
  assert.match(out, /⚠ stale \(code, scenario\)/)
})

test('formatTimeline: the verdict renders — pass / fail / fail+note / legacy', () => {
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'pass' } })])), /✓ pass/)
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'fail' } })])), /✗ fail/)
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'fail', note: 'off by a row' } })])), /✗ fail — off by a row/)
  assert.match(formatTimeline(timeline([reading({})])), /legacy/)   // no verdict → legacy
  // a legacy note-only reading (status:'note' predates the annotation model) still shows its note
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'note', note: 'off by a row' } as any })])), /≈ off by a row/)
})

test('formatTimeline: the scenario expected shows on its own indented line', () => {
  const out = formatTimeline(timeline([reading({ expected: 'lands on the dashboard' })]))
  assert.match(out, /expected: lands on the dashboard/)
})

test('formatTimeline: evidence state renders image / transcript / miss / no evidence', () => {
  assert.match(formatTimeline(timeline([reading({ blobState: 'present', blobKind: 'image', blob: 'deadbeefcafebabe00' })])), /image deadbeefcafe…/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'present', blobKind: 'transcript', blob: 'feedface00112233' })])), /transcript feedface0011…/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'present', blobKind: 'video', blob: '0badc0ffee001122' })])), /video 0badc0ffee00…/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'miss', blob: 'a'.repeat(64) })])), /miss original file/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'none', blob: null })])), /no evidence/)
})

test('formatTimeline: a mixed reading lists every evidence entry (N images + a video)', () => {
  const out = formatTimeline(timeline([reading({
    blobState: 'present', blob: 'img1aaaaaaaaaaaa',
    evidence: [
      { hash: 'img1aaaaaaaaaaaa', kind: 'image', state: 'present' },
      { hash: 'img2bbbbbbbbbbbb', kind: 'image', state: 'present' },
      { hash: 'clipcccccccccccc', kind: 'video', state: 'present' },
    ],
  })]))
  assert.match(out, /image img1aaaaaaaa…, image img2bbbbbbbb…, video clipcccccccc…/)
})

test('formatTimeline: retraction events render as the undo trace — beside readings, and even when all readings are retracted', () => {
  const retractions = [{ retracts: 't9', scenario: 's', note: 'botched smoke run', by: 'sess-1', ts: 't10' }]
  const withReadings = formatTimeline(timeline([reading({})], { retractions }))
  assert.match(withReadings, /⟲ retracted: scenario 's' reading @ t9 — botched smoke run {2}by sess-1/)
  const allRetracted = formatTimeline(timeline([], { retractions }))
  assert.match(allRetracted, /no reading yet/)          // effective view is honestly unmeasured…
  assert.match(allRetracted, /⟲ retracted: scenario 's'/)   // …but the trace still shows
})
