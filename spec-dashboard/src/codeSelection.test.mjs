import test from 'node:test'
import assert from 'node:assert/strict'
import { decodePrompt, encodeCodeSelection, encodePrompt, selectionLabel } from './codeSelection.js'

const selection = {
  path: 'spec-dashboard/src/SourceView.jsx',
  startLine: 12,
  endLine: 15,
  text: 'const first = "<!-- spexcode-selection -->"\nreturn first',
}

test('code selection token round-trips metadata and arbitrary source text', () => {
  const encoded = encodePrompt('Please explain this.', [selection])
  const decoded = decodePrompt(encoded)
  assert.equal(decoded.text, 'Please explain this.')
  assert.deepEqual(decoded.selections, [selection])
  assert.equal(selectionLabel(selection), 'spec-dashboard/src/SourceView.jsx:12-15')
})

// [[prose-selection]]: a passage of spec prose travels as the SAME token, plus the node that owns it.
const prose = {
  node: 'spec-view',
  path: '.spec/spexcode/spec-dashboard/dashboard-ui/spec-view/spec.md',
  startLine: 3,
  endLine: 4,
  text: 'The prose on the left, the code it governs on the right.',
}

test('a prose selection round-trips its node id and leads its label with it', () => {
  const decoded = decodePrompt(encodePrompt('What does this mean?', [prose]))
  assert.equal(decoded.text, 'What does this mean?')
  assert.deepEqual(decoded.selections, [prose])
  assert.equal(selectionLabel(prose), 'spec-view:3-4')
  // the two flavours travel together in one prompt, and neither loses its address
  const both = decodePrompt(encodePrompt('look', [selection, prose]))
  assert.deepEqual(both.selections, [selection, prose])
})

test('an empty or non-string node is not an address, so the token is refused', () => {
  assert.throws(() => encodeCodeSelection({ ...prose, node: '' }), TypeError)
  assert.throws(() => encodeCodeSelection({ ...prose, node: 7 }), TypeError)
  assert.equal(decodePrompt(`<!-- spexcode-selection ${JSON.stringify({ ...prose, node: '' })} -->`).selections.length, 0)
})

test('malformed selection tokens stay visible instead of disappearing', () => {
  const malformed = '<!-- spexcode-selection {"path":"x"} -->'
  assert.equal(decodePrompt(`Intent\n\n${malformed}`).text, `Intent\n\n${malformed}`)
  assert.equal(encodeCodeSelection(selection).startsWith('<!-- spexcode-selection '), true)
})
