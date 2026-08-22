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

test('malformed selection tokens stay visible instead of disappearing', () => {
  const malformed = '<!-- spexcode-selection {"path":"x"} -->'
  assert.equal(decodePrompt(`Intent\n\n${malformed}`).text, `Intent\n\n${malformed}`)
  assert.equal(encodeCodeSelection(selection).startsWith('<!-- spexcode-selection '), true)
})
