import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishReviewSnapshot, readReviewSnapshot, type ReviewSnapshot } from './reviewSnapshot.js'

test('review snapshot publication replaces Issues and Evals as one atomic generation', () => {
  const first: ReviewSnapshot = {
    issues: [{ id: 'i-1' }],
    evalNodes: [{ id: 'n-1', scenarios: [{ name: 's-1' }], evals: [], readings: [] }],
  }
  const second: ReviewSnapshot = {
    issues: [{ id: 'i-2' }, { id: 'i-3' }],
    evalNodes: [{ id: 'n-2', scenarios: [], evals: [{ scenario: 's-2' }], readings: [{ scenario: 's-2' }] }],
  }

  publishReviewSnapshot(first)
  assert.strictEqual(readReviewSnapshot(), first)
  publishReviewSnapshot(second)
  assert.strictEqual(readReviewSnapshot(), second)
  assert.deepEqual(readReviewSnapshot().issues.map((issue) => issue.id), ['i-2', 'i-3'])
  assert.deepEqual(readReviewSnapshot().evalNodes.map((node) => node.id), ['n-2'])
})
