import test from 'node:test'
import assert from 'node:assert/strict'
import { assertStatusOwnership } from './statusOwnership.js'

const view = { kind: 'view', page: 'evals' }

test('view status contributions stay in the focused-document group', () => {
  assert.doesNotThrow(() => assertStatusOwnership({ id: 'eval-count', side: 'right', text: '1' }, view))
  assert.throws(() => assertStatusOwnership({ id: 'rail', side: 'left', text: 'x' }, view), /right group/)
  assert.throws(() => assertStatusOwnership({ id: 'markup', side: 'right', node: {} }, view), /mount markup/)
})

test('shell-owned status items retain full chrome permissions', () => {
  const item = { id: 'project', side: 'left', node: {} }
  assert.equal(assertStatusOwnership(item), item)
})
