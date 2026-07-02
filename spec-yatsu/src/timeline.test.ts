import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateTimeline, stepAt, type TimelineEvent } from './timeline.js'

const good = { v: 1, events: [{ tMs: 0, step: 'open board' }, { tMs: 4200, step: 'login', node: 'sessions' }, { tMs: 9000, step: 'submit' }] }

test('validateTimeline: a well-formed timeline passes clean', () => {
  assert.deepEqual(validateTimeline(good), [])
  assert.deepEqual(validateTimeline({ v: 1, events: [] }), [])   // empty map is legal — a plain player
})

test('validateTimeline: rejects LOUD — wrong root, unknown keys, bad values, out of order', () => {
  assert.ok(validateTimeline(null).length)
  assert.ok(validateTimeline([1]).length)
  assert.ok(validateTimeline({ v: 2, events: [] }).some((e) => e.includes('`v`')))
  assert.ok(validateTimeline({ v: 1, events: [], extra: true }).some((e) => e.includes('unknown field `extra`')))
  assert.ok(validateTimeline({ v: 1, events: [{ tMs: 1, step: 'a', stepp: 'typo' }] }).some((e) => e.includes('unknown field `stepp`')))
  assert.ok(validateTimeline({ v: 1, events: [{ tMs: -5, step: 'a' }] }).some((e) => e.includes('≥ 0')))
  assert.ok(validateTimeline({ v: 1, events: [{ tMs: 5, step: '' }] }).some((e) => e.includes('non-empty')))
  assert.ok(validateTimeline({ v: 1, events: [{ tMs: 9, step: 'b' }, { tMs: 3, step: 'a' }] }).some((e) => e.includes('out of order')))
  assert.ok(validateTimeline({ v: 1, events: [{ tMs: 1, step: 'a', node: ' ' }] }).some((e) => e.includes('`node`') || e.includes('.node')))
})

test('stepAt: last event at or before T; null before the first', () => {
  const ev = good.events as TimelineEvent[]
  assert.equal(stepAt(ev, 0)?.step, 'open board')      // exact first boundary
  assert.equal(stepAt(ev, 4199)?.step, 'open board')   // just before the next
  assert.equal(stepAt(ev, 4200)?.step, 'login')        // exact boundary
  assert.equal(stepAt(ev, 999999)?.step, 'submit')     // after the last → last wins
  assert.equal(stepAt([{ tMs: 100, step: 'late' }], 50), null)   // before the first event → no step to name
  assert.equal(stepAt([], 0), null)
  assert.equal(stepAt(ev, 5000)?.node, 'sessions')     // the owning-node rides the hit
})
