import { test } from 'node:test'
import assert from 'node:assert'
import { latestPerScenario, slimScenarios } from './graph.js'

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

// The scenario fold is the opposite contract: a PROJECTION to {name, tags} — prose (description/expected)
// and per-scenario code must NOT ride the board; they reach their viewers via /api/specs/lite and
// /api/specs/:id/evals instead. Empty tags are omitted, not shipped as [].
test('board scenarios are slim — name and tags only, no prose, no code', () => {
  const declared = [
    { name: 'a', description: 'long prose', expected: 'longer prose', tags: ['frontend-e2e'], code: ['x.ts'] },
    { name: 'b', description: 'd', expected: 'e' },
  ]
  assert.deepStrictEqual(slimScenarios(declared), [{ name: 'a', tags: ['frontend-e2e'] }, { name: 'b' }])
})
