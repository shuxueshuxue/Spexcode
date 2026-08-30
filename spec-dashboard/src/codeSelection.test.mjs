import test from 'node:test'
import assert from 'node:assert/strict'
import { decodePrompt, encodeCodeSelection, encodePrompt, isTimelineSelection, selectionLabel } from './codeSelection.js'

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

// A TIMELINE PASSAGE IS THE SAME TOKEN WITH A DIFFERENT ADDRESS. It has no path and no line to point at, so
// it names the session it was read in and the moment it was said; everything else — the comment, the lossless
// text, the validator, the ordinary prompt — is shared with the two file-shaped flavours.
test('a quoted timeline passage rides the same token, addressed by session and moment', () => {
  const quote = {
    session: '56aab453-8d57-4482-be9c-193aab7a9412',
    at: '2026-08-30T09:00:00.000Z',
    text: 'a passage that itself contains <!-- spexcode-selection --> and two\nlines',
  }
  const decoded = decodePrompt(encodePrompt('why this?', [quote]))
  assert.equal(decoded.text, 'why this?')
  assert.deepEqual(decoded.selections, [quote])
  assert.equal(selectionLabel(quote), '56aab453-8d57-4482-be9c-193aab7a9412@2026-08-30T09:00:00.000Z')
  assert.equal(isTimelineSelection(quote), true)
  assert.equal(isTimelineSelection({ path: 'a.js', startLine: 1, endLine: 1, text: 'x' }), false)
})

// The flavours are exclusive. A token carrying both addresses is not "either one" — it is malformed, and a
// reader that guessed would silently attribute a passage to a file it never came from.
test('a selection token is one flavour and never a blend', () => {
  const at = '2026-08-30T09:00:00.000Z'
  assert.throws(() => encodeCodeSelection({ session: 's', at, path: 'a.js', startLine: 1, endLine: 1, text: 't' }), TypeError)
  assert.throws(() => encodeCodeSelection({ session: 's', at: 'not-a-time', text: 't' }), TypeError)
  assert.throws(() => encodeCodeSelection({ session: '', at, text: 't' }), TypeError)
  assert.throws(() => encodeCodeSelection({ session: 's', at, text: 7 }), TypeError)
  // a malformed one stays visible text rather than being silently dropped
  const bad = `<!-- spexcode-selection ${JSON.stringify({ session: 's', at: 'nope', text: 't' })} -->`
  const decoded = decodePrompt(bad)
  assert.equal(decoded.selections.length, 0)
  assert.match(decoded.text, /spexcode-selection/)
})
