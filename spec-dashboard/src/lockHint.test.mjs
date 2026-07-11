import test from 'node:test'
import assert from 'node:assert/strict'
import { lockCycleKeyLabels, showLockCycleKeys } from './lockHint.js'

test('lock hint hides cycle keys when there is only one changed node', () => {
  assert.equal(showLockCycleKeys(0), false)
  assert.equal(showLockCycleKeys(1), false)
  assert.equal(showLockCycleKeys(2), true)
})

test('lock hint keeps uppercase reverse key without an extra modifier label', () => {
  const keysFor = (id) => id === 'graph.cycle' ? ['o'] : ['O']

  assert.deepEqual(lockCycleKeyLabels(keysFor), {
    next: 'o',
    prev: 'O',
  })
})
