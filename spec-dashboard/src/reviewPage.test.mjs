import test from 'node:test'
import assert from 'node:assert/strict'
import { paginationTokens, reviewPageNumber } from './reviewPage.js'

test('page parsing preserves every positive requested page and repairs invalid input', () => {
  assert.equal(reviewPageNumber('1'), 1)
  assert.equal(reviewPageNumber('999999'), 999999)
  for (const value of [undefined, '', '0', '-1', '1.5', 'nope']) assert.equal(reviewPageNumber(value), 1)
})

test('GitHub-shaped page windows keep edge ranges and stable ellipses', () => {
  assert.deepEqual(paginationTokens(1, 4), [1, 2, 3, 4])
  assert.deepEqual(paginationTokens(2, 40), [1, 2, 3, 4, 5, 6, 7, 8, 'gap', 39, 40])
  assert.deepEqual(paginationTokens(20, 40), [1, 2, 'gap', 18, 19, 20, 21, 22, 'gap', 39, 40])
  assert.deepEqual(paginationTokens(40, 40), [1, 2, 'gap', 33, 34, 35, 36, 37, 38, 39, 40])
  assert.deepEqual(paginationTokens(999999, 40), [1, 2, 'gap', 33, 34, 35, 36, 37, 38, 39, 40])
})
