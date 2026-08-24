import test from 'node:test'
import assert from 'node:assert/strict'
import { isGovernancePath } from './fileStatusPath.js'

test('governance metadata paths stay out of the ambient file status item', () => {
  assert.equal(isGovernancePath('.spec/session-protocol/eval.md'), true)
  assert.equal(isGovernancePath('.spec/session-protocol/spec.md'), true)
  assert.equal(isGovernancePath('.spec/session-protocol/evals.ndjson'), true)
  assert.equal(isGovernancePath('src/app.js'), false)
  assert.equal(isGovernancePath('.spec/session-protocol/README.md'), false)
})
