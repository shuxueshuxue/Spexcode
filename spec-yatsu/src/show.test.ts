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
  ({ node: 'n', hasYatsu: true, readings, ...over })

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

test('formatTimeline: the verdict renders — pass / fail / note / legacy', () => {
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'pass' } })])), /✓ pass/)
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'fail' } })])), /✗ fail/)
  assert.match(formatTimeline(timeline([reading({ verdict: { status: 'note', note: 'off by a row' } })])), /≈ note: off by a row/)
  assert.match(formatTimeline(timeline([reading({})])), /legacy/)   // no verdict → legacy
})

test('formatTimeline: the scenario expected shows on its own indented line', () => {
  const out = formatTimeline(timeline([reading({ expected: 'lands on the dashboard' })]))
  assert.match(out, /expected: lands on the dashboard/)
})

test('formatTimeline: evidence state renders image / transcript / miss / no evidence', () => {
  assert.match(formatTimeline(timeline([reading({ blobState: 'present', blobKind: 'image', blob: 'deadbeefcafebabe00' })])), /image deadbeefcafe…/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'present', blobKind: 'transcript', blob: 'feedface00112233' })])), /transcript feedface0011…/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'miss', blob: 'a'.repeat(64) })])), /miss original file/)
  assert.match(formatTimeline(timeline([reading({ blobState: 'none', blob: null })])), /no evidence/)
})
