import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayWidth, truncWidth, padWidth, formatTable } from './sessions.js'
import type { Session } from './sessions.js'

// Pins the display-width contract of `spex ls` ([[ls-cjk-width]]): the table aligns by terminal CELLS,
// not code units. CJK glyphs are two cells wide, so unit-counting slice/padEnd sheared labels mid-glyph
// and misaligned every column after a CJK NODE or PROMPT.

const sess = (over: Partial<Session> = {}): Session => ({
  id: 'abcdef1234', node: 'x', branch: 'node/x', path: '/wt/x',
  label: 'x', headline: 'x', raw: { name: null, title: null }, parent: null,
  harness: 'claude', launcher: null,
  lifecycle: 'active', proposal: null, merges: 0, status: 'working', liveness: 'online', note: null,
  prompt: null, promptPreview: null, created: 1, activity: null, sortKey: null,
  ...over,
})

test('displayWidth: ASCII counts 1/char, CJK counts 2/char', () => {
  assert.equal(displayWidth('abc'), 3)
  assert.equal(displayWidth('把最新的'), 8)
  assert.equal(displayWidth('装到 macmini'), 12) // 2+2+1+7
  assert.equal(displayWidth(''), 0)
})

test('truncWidth: pure-ASCII behaviour unchanged from the old code-unit trunc', () => {
  assert.equal(truncWidth('short label', 22), 'short label')
  // over-long ASCII: cut to max-1 chars + ellipsis, total display width == max — the old behaviour
  const long = 'a'.repeat(30)
  const cut = truncWidth(long, 22)
  assert.equal(cut, 'a'.repeat(21) + '…')
  assert.equal(displayWidth(cut), 22)
})

test('truncWidth: CJK truncates on display width, never past the budget, never mid-glyph', () => {
  const label = '把最新的 spexcode 装到 macmini 上'
  const cut = truncWidth(label, 22)
  assert.ok(cut.endsWith('…'))
  assert.ok(displayWidth(cut) <= 22, `width ${displayWidth(cut)} must fit the 22-cell column`)
  // every kept glyph is intact and in order — the cut is a strict prefix of the original
  assert.ok(label.startsWith(cut.slice(0, -1)))
})

test('padWidth: pads CJK to the target display width where padEnd under-pads', () => {
  const s = '装到 macmini' // 12 cells but 10 code units — padEnd(22) would leave it two cells short
  assert.equal(displayWidth(padWidth(s, 22)), 22)
  assert.equal(padWidth('abc', 5), 'abc  ')
  assert.equal(padWidth('wider than asked', 3), 'wider than asked') // never truncates
})

test('formatTable: columns align (equal display width before ID) for mixed ASCII/CJK rows', () => {
  const rows = formatTable([
    sess({ id: 'aaaa1111', label: 'plain-ascii-label', promptPreview: 'do the thing' }),
    sess({ id: 'bbbb2222', label: '把最新的 spexcode 装到 macmini 上', promptPreview: '把最新的 spexcode 装到 macmini 上并重启服务和面板' }),
  ], false).split('\n')
  const [a, b] = [rows.find((r) => r.includes('aaaa1111'))!, rows.find((r) => r.includes('bbbb2222'))!]
  assert.ok(a && b, 'both rows render')
  const before = (row: string, mark: string) => displayWidth(row.slice(0, row.indexOf(mark)))
  assert.equal(before(a, 'aaaa1111'), before(b, 'bbbb2222'), 'the ID column starts at the same cell')
  // and the NOTE column after the 42-cell PROMPT field aligns too
  const withNotes = formatTable([
    sess({ id: 'aaaa1111', label: 'plain-ascii-label', promptPreview: 'do the thing', note: 'NOTE-A' }),
    sess({ id: 'bbbb2222', label: '把最新的 spexcode 装到 macmini 上', promptPreview: '把最新的 spexcode 装到 macmini 上并重启服务和面板', note: 'NOTE-B' }),
  ], false).split('\n')
  const [na, nb] = [withNotes.find((r) => r.includes('NOTE-A'))!, withNotes.find((r) => r.includes('NOTE-B'))!]
  assert.equal(before(na, 'NOTE-A'), before(nb, 'NOTE-B'), 'the NOTE column starts at the same cell')
})

test('formatTable: a pure-ASCII row renders exactly as before (padEnd-equivalent field)', () => {
  const row = formatTable([sess({ label: 'plain-ascii-label' })], false)
    .split('\n').find((r) => r.includes('abcdef12'))!
  assert.ok(row.includes(' ' + 'plain-ascii-label'.padEnd(22) + ' abcdef12'), 'ASCII NODE field is the classic padEnd(22)')
})
