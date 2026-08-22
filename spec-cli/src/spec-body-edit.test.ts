import test from 'node:test'
import assert from 'node:assert/strict'

import { specContent } from '@spexcode/spec-core'
import { editSpecBody, readSpecBodyEdit, SpecBodyEditError } from './spec-body-edit.js'

// Every refusal below happens BEFORE a byte is written, which is why these can run against the live spec
// tree: the point of the endpoint's preconditions is that a request that cannot be honoured never touches
// the file. The write half is proved through the product, where a commit is the evidence.

const NODE = 'spec-body-edit'

test('a request without an honest line range or both texts is refused before anything is read', () => {
  const bad = [
    {},
    { startLine: 0, endLine: 3, original: '', replacement: '' },
    { startLine: 4, endLine: 3, original: '', replacement: '' },
    { startLine: 1.5, endLine: 3, original: '', replacement: '' },
  ]
  for (const body of bad) assert.throws(() => readSpecBodyEdit(body), SpecBodyEditError)
  assert.throws(() => readSpecBodyEdit({ startLine: 1, endLine: 2, original: 'x' }), /original, replacement/)
  assert.throws(() => readSpecBodyEdit({ startLine: 1, endLine: 2, replacement: 'x' }), /original, replacement/)
  assert.deepEqual(readSpecBodyEdit({ startLine: 1, endLine: 2, original: 'a', replacement: 'b', reason: '  why  ' }),
    { startLine: 1, endLine: 2, original: 'a', replacement: 'b', reason: 'why' })
  // an empty reason is no reason, not an empty line in the commit message
  assert.deepEqual(readSpecBodyEdit({ startLine: 1, endLine: 1, original: 'a', replacement: 'b', reason: '   ' }),
    { startLine: 1, endLine: 1, original: 'a', replacement: 'b' })
})

test('an id that is not a node has no body to edit', async () => {
  await assert.rejects(
    editSpecBody('no-such-node-at-all', { startLine: 1, endLine: 1, original: '', replacement: 'x' }),
    (e: unknown) => e instanceof SpecBodyEditError && e.status === 404 && e.code === 'no-node',
  )
})

test('a region whose text no longer matches is a refusal that reports what is actually there', async () => {
  const content = specContent(NODE)
  assert.ok(content, `${NODE} must be a real node for this test to mean anything`)
  await assert.rejects(
    editSpecBody(NODE, { startLine: 1, endLine: 1, original: 'this is not what line 1 says', replacement: 'x' }),
    (e: unknown) => {
      assert.ok(e instanceof SpecBodyEditError)
      assert.equal(e.status, 409)
      assert.equal(e.code, 'stale-region')
      // the collision is legible: the caller gets the line it collided with, not just a verdict
      assert.equal(e.detail?.current, content!.body.split('\n')[0])
      return true
    },
  )
})

test('a range that runs past the end of the body is refused, never clamped', async () => {
  const content = specContent(NODE)
  assert.ok(content)
  const lines = content!.body.split('\n').length
  await assert.rejects(
    editSpecBody(NODE, { startLine: lines, endLine: lines + 5, original: '', replacement: 'x' }),
    (e: unknown) => e instanceof SpecBodyEditError && e.status === 409 && e.code === 'stale-region'
      && e.detail?.bodyLines === lines,
  )
})

test('replacing a region with the identical text writes nothing and commits nothing', async () => {
  const content = specContent(NODE)
  assert.ok(content)
  const first = content!.body.split('\n')[0]
  const result = await editSpecBody(NODE, { startLine: 1, endLine: 1, original: first, replacement: first })
  assert.equal(result.changed, false)
  assert.equal(result.commit, null)
  assert.match(result.path, /^\.spec\/.*\/spec\.md$/)
})
