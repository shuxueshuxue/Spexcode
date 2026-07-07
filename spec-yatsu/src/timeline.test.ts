import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateTimeline, normalizeTimeline, stepAt, type TimelineEvent } from './timeline.js'

const good = { v: 2, axis: 'time', events: [{ at: 0, step: 'open board' }, { at: 4200, step: 'login', node: 'sessions' }, { at: 9000, step: 'submit' }] }
const goodV1 = { v: 1, events: [{ tMs: 0, step: 'open board' }, { tMs: 4200, step: 'login', node: 'sessions' }, { tMs: 9000, step: 'submit' }] }

test('validateTimeline: a well-formed v2 timeline passes clean, on any axis', () => {
  assert.deepEqual(validateTimeline(good), [])
  assert.deepEqual(validateTimeline({ v: 2, axis: 'line', events: [{ at: 42, step: 'read' }] }), [])
  assert.deepEqual(validateTimeline({ v: 2, axis: 'frame', events: [{ at: 3, step: 'hover' }] }), [])
  assert.deepEqual(validateTimeline({ v: 2, axis: 'custom-axis', events: [{ at: 1, step: 'x' }] }), [])   // open by convention
  assert.deepEqual(validateTimeline({ v: 2, axis: 'time', events: [] }), [])   // empty map is legal — a plain player
})

test('validateTimeline: legacy v1 (time axis, tMs) still passes clean', () => {
  assert.deepEqual(validateTimeline(goodV1), [])
  assert.deepEqual(validateTimeline({ v: 1, events: [] }), [])
})

test('validateTimeline: rejects LOUD — wrong root, bad version, missing axis, unknown keys, bad values, out of order', () => {
  assert.ok(validateTimeline(null).length)
  assert.ok(validateTimeline([1]).length)
  assert.ok(validateTimeline({ v: 3, axis: 'time', events: [] }).some((e) => e.includes('`v`')))
  assert.ok(validateTimeline({ v: 2, events: [] }).some((e) => e.includes('`axis`')))               // v2 needs an axis
  assert.ok(validateTimeline({ v: 2, axis: '  ', events: [] }).some((e) => e.includes('`axis`')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [], extra: true }).some((e) => e.includes('unknown field `extra`')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ at: 1, step: 'a', att: 'typo' }] }).some((e) => e.includes('unknown field `att`')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ tMs: 1, step: 'a' }] }).some((e) => e.includes('unknown field `tMs`')))   // v1 key in a v2 map
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ at: -5, step: 'a' }] }).some((e) => e.includes('≥ 0')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ at: 5, step: '' }] }).some((e) => e.includes('non-empty')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ at: 9, step: 'b' }, { at: 3, step: 'a' }] }).some((e) => e.includes('out of order')))
  assert.ok(validateTimeline({ v: 2, axis: 'time', events: [{ at: 1, step: 'a', node: ' ' }] }).some((e) => e.includes('`node`') || e.includes('.node')))
  assert.ok(validateTimeline({ v: 1, events: [{ at: 1, step: 'a' }] }).some((e) => e.includes('unknown field `at`')))   // v2 key in a v1 map
})

test('normalizeTimeline: v1 and its v2/time equivalent normalize to the SAME axis-tagged shape (lossless back-compat)', () => {
  const a = normalizeTimeline(goodV1)
  const b = normalizeTimeline(good)
  assert.equal(a.axis, 'time')
  assert.deepEqual(a, b)   // v1 tMs → at, axis 'time' — byte-identical to the v2/time form
  const line = normalizeTimeline({ v: 2, axis: 'line', events: [{ at: 42, step: 'read' }] })
  assert.deepEqual(line, { axis: 'line', events: [{ at: 42, step: 'read' }] })
})

test('stepAt: last event at or before a position; null before the first — on any axis', () => {
  const ev = good.events as TimelineEvent[]
  assert.equal(stepAt(ev, 0)?.step, 'open board')      // exact first boundary
  assert.equal(stepAt(ev, 4199)?.step, 'open board')   // just before the next
  assert.equal(stepAt(ev, 4200)?.step, 'login')        // exact boundary
  assert.equal(stepAt(ev, 999999)?.step, 'submit')     // after the last → last wins
  assert.equal(stepAt([{ at: 100, step: 'late' }], 50), null)   // before the first event → no step to name
  assert.equal(stepAt([], 0), null)
  assert.equal(stepAt(ev, 5000)?.node, 'sessions')     // the owning-node rides the hit
})
