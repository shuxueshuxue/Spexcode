import assert from 'node:assert/strict'
import test from 'node:test'
import * as sessions from './sessions.js'

test('the retired markError facade stays absent', () => {
  assert.equal('markError' in sessions, false)
  assert.equal(typeof sessions.markState, 'function')
})
