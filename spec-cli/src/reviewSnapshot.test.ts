import { test } from 'node:test'
import assert from 'node:assert/strict'
import { issueSourceCurrent, publishReviewSnapshot, readReviewSnapshot, type ReviewSnapshot } from '@spexcode/spec-core'

test('review snapshot publication replaces Issues and Evals as one atomic generation', () => {
  const first: ReviewSnapshot = {
    issues: [{ id: 'i-1' }],
    evalNodes: [{ id: 'n-1', scenarios: [{ name: 's-1' }], evals: [], readings: [] }],
    issueSource: { forge: 1, local: 0 },
  }
  const second: ReviewSnapshot = {
    issues: [{ id: 'i-2' }, { id: 'i-3' }],
    evalNodes: [{ id: 'n-2', scenarios: [], evals: [{ scenario: 's-2' }], readings: [{ scenario: 's-2' }] }],
    issueSource: { forge: 2, local: 1 },
  }

  publishReviewSnapshot(first)
  assert.strictEqual(readReviewSnapshot(), first)
  publishReviewSnapshot(second)
  assert.strictEqual(readReviewSnapshot(), second)
  assert.deepEqual(readReviewSnapshot().issues.map((issue) => issue.id), ['i-2', 'i-3'])
  assert.deepEqual(readReviewSnapshot().evalNodes.map((node) => node.id), ['n-2'])
  assert.deepEqual(readReviewSnapshot().issueSource, { forge: 2, local: 1 })
})

test('a publication is current only when EVERY issue store reached what the read requires', () => {
  // The whole point of one carrier per store: a newer forge revision must not pay for a missed local write.
  assert.equal(issueSourceCurrent({ forge: 5, local: 3 }, { forge: 5, local: 3 }), true)
  assert.equal(issueSourceCurrent({ forge: 9, local: 3 }, { forge: 5, local: 3 }), true, 'ahead on one, level on the other')
  assert.equal(issueSourceCurrent({ forge: 9, local: 2 }, { forge: 5, local: 3 }), false, 'a forge lead cannot cover a local write')
  assert.equal(issueSourceCurrent({ forge: 4, local: 9 }, { forge: 5, local: 3 }), false, 'nor the reverse')
})
