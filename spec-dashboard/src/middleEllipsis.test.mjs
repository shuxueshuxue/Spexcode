import test from 'node:test'
import assert from 'node:assert/strict'
import { middleEllipsis } from './specMeta.js'

test('middle ellipsis biases the 14-character budget toward distinguishing suffixes', () => {
  const labels = [
    'session-management-construction',
    'session-management-platform',
    'session-management-refactor',
    'session-management-roadmap',
    'session-management-review',
  ]
  const rendered = labels.map((label) => middleEllipsis(label))
  assert.ok(rendered.every((label) => label.length === 14))
  assert.ok(rendered.every((label) => label.startsWith('sessi…')))
  assert.deepEqual(rendered.map((label) => label.slice(6)), labels.map((label) => label.slice(-8)))
  assert.equal(new Set(rendered).size, labels.length)
})
