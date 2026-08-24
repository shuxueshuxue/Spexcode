import test from 'node:test'
import assert from 'node:assert/strict'
import { locatePart, proseSelection, regionText, stampedRange } from './proseSelection.js'
import { parseProseTokens } from './proseTokens.js'

const BODY = [
  '## raw source',                      // 1
  '',                                   // 2
  'The board should let a reader act',   // 3
  'on the passage they are looking at.', // 4
  '',                                   // 5
  '## expanded spec',                   // 6
  '',                                   // 7
  '- one bullet',                       // 8
  '- another bullet',                   // 9
].join('\n')

test('a rendered part is placed against the whole body, and the placement is verified', () => {
  const raw = 'The board should let a reader act\non the passage they are looking at.'
  assert.deepEqual(locatePart(BODY, raw), { startLine: 3, endLine: 4 })
  assert.deepEqual(locatePart(BODY, '- one bullet\n- another bullet'), { startLine: 8, endLine: 9 })
  // a part that is not a slice of this body has no honest line range — better nothing than a wrong one
  assert.equal(locatePart(BODY, 'prose that is not in the body'), null)
  assert.equal(locatePart('', 'anything'), null)
  assert.equal(locatePart(BODY, ''), null)
})

test('a region is the verbatim body lines, refusing ranges it cannot honour', () => {
  assert.equal(regionText(BODY, 3, 4), 'The board should let a reader act\non the passage they are looking at.')
  assert.equal(regionText(BODY, 1, 1), '## raw source')
  assert.equal(regionText(BODY, 9, 9), '- another bullet')
  assert.equal(regionText(BODY, 0, 2), '')          // 1-based, so 0 is not a line
  assert.equal(regionText(BODY, 4, 3), '')          // inverted
  assert.equal(regionText(BODY, 8, 99), '')         // past the end
})

// the smallest addressable region is the DEEPEST stamped element the selection touches: a list stamps both
// the <ul> and each <li>, and rounding a one-bullet selection up to the whole list is the bug this guards.
const fakeHost = (marks) => ({
  querySelectorAll: () => marks,
})
const el = (l0, l1, children = []) => {
  const node = { dataset: { l0: String(l0), l1: String(l1) }, children }
  node.contains = (other) => children.includes(other) || children.some((k) => k.contains?.(other))
  return node
}
const rangeOver = (hits) => ({ collapsed: false, intersectsNode: (node) => hits.includes(node) })

test('a selection resolves to the deepest stamped blocks it touches', () => {
  const li8 = el(8, 8)
  const li9 = el(9, 9)
  const ul = el(8, 9, [li8, li9])
  const para = el(3, 4)
  const marks = [para, ul, li8, li9]

  // one bullet: the <ul> also intersects, but it yields to the <li> inside it
  assert.deepEqual(stampedRange(rangeOver([ul, li9]), fakeHost(marks)), { startLine: 9, endLine: 9 })
  // the whole list: every item is a leaf, and their union is the list's own range
  assert.deepEqual(stampedRange(rangeOver([ul, li8, li9]), fakeHost(marks)), { startLine: 8, endLine: 9 })
  // across blocks: the union spans from the first line of the first to the last line of the last
  assert.deepEqual(stampedRange(rangeOver([para, ul, li8, li9]), fakeHost(marks)), { startLine: 3, endLine: 9 })
  // nothing stamped under the selection is not a guess — it is no selection at all
  assert.equal(stampedRange(rangeOver([]), fakeHost(marks)), null)
  assert.equal(stampedRange({ collapsed: true }, fakeHost(marks)), null)
  assert.equal(stampedRange(null, fakeHost(marks)), null)
})

test('a stamped element with an unusable range is ignored rather than trusted', () => {
  const broken = { dataset: { l0: 'x', l1: '4' }, contains: () => false }
  const inverted = { dataset: { l0: '9', l1: '2' }, contains: () => false }
  const good = el(3, 4)
  const marks = [broken, inverted, good]
  assert.deepEqual(stampedRange(rangeOver(marks), fakeHost(marks)), { startLine: 3, endLine: 4 })
  assert.equal(stampedRange(rangeOver([broken, inverted]), fakeHost([broken, inverted])), null)
})

test('a prose selection carries the node id beside the four fields a source selection carries', () => {
  const node = { id: 'spec-view', path: '.spec/spexcode/spec-dashboard/dashboard-ui/spec-view/spec.md' }
  assert.deepEqual(proseSelection(node, BODY, { startLine: 3, endLine: 4 }), {
    node: 'spec-view',
    path: node.path,
    startLine: 3,
    endLine: 4,
    text: 'The board should let a reader act\non the passage they are looking at.',
  })
  // a blank region is not context worth sending
  assert.equal(proseSelection(node, BODY, { startLine: 2, endLine: 2 }), null)
  assert.equal(proseSelection(null, BODY, { startLine: 3, endLine: 4 }), null)
  assert.equal(proseSelection(node, BODY, null), null)
})

test('prose selection provenance is sourced from semantic parser maps, not rendered text', () => {
  const tokens = parseProseTokens('First line\nsecond line')
  const paragraph = tokens.find((token) => token.type === 'paragraph_open')
  assert.deepEqual(paragraph?.map, [0, 2])
  assert.equal(tokens.find((token) => token.type === 'inline')?.content, 'First line\nsecond line')
})
