import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const attachment = readFileSync(new URL('./SelectionAttachment.jsx', import.meta.url), 'utf8')
const prose = readFileSync(new URL('./ProseActions.jsx', import.meta.url), 'utf8')
const sessions = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const timeline = readFileSync(new URL('./TimelineChat.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('every selection home uses one removable attachment producer', () => {
  assert.match(attachment, /export default function SelectionAttachment\(/)
  assert.match(attachment, /className=\{`selection-attachment/)
  // the mark follows the flavour and BOTH live in this one component: a diff mark for a passage that lives
  // in a file, the reply mark for one quoted out of a conversation. Neither producer may pick its own.
  assert.match(attachment, /'corner-up-left' : 'file-diff'/)
  assert.doesNotMatch(prose, /file-diff/)
  assert.doesNotMatch(timeline, /file-diff|corner-up-left'\s*,\s*size/)
  assert.match(attachment, /selection-attachment-remove/)
  assert.match(timeline, /import SelectionAttachment from ['"]\.\/SelectionAttachment\.jsx['"]/)
  assert.match(timeline, /<SelectionAttachment key=\{`\$\{quote\.at\}/)
  assert.match(prose, /import SelectionAttachment from ['"]\.\/SelectionAttachment\.jsx['"]/)
  assert.match(prose, /<SelectionAttachment selection=\{selection\} onRemove=\{onRemove\}/)
  assert.match(prose, /onRemove=\{clear\}/)
  assert.match(sessions, /import SelectionAttachment from ['"]\.\/SelectionAttachment\.jsx['"]/)
  assert.match(sessions, /<SelectionAttachment key=\{`\$\{selection\.path\}/)
  assert.doesNotMatch(prose, /function SelectionChip\(/)
  assert.doesNotMatch(sessions, /<div key=\{`\$\{selection\.path\}/)
})

test('attachment styling is shared instead of two chip dialects', () => {
  assert.match(css, /\.selection-attachment\s*\{[\s\S]*border-left: 3px solid var\(--blue\)/)
  assert.match(css, /\.selection-attachment-address\s*\{[\s\S]*text-overflow: ellipsis/)
  assert.match(css, /\.selection-attachment-range\s*\{[\s\S]*font-variant-numeric: tabular-nums/)
  assert.doesNotMatch(prose, /className="pa-chip"/)
  assert.doesNotMatch(sessions, /si-code-selection-chip/)
  assert.doesNotMatch(css, /\.si-code-selection-chip\s*\{|\.pa-chip-label\s*\{|\.pa-chip-node\s*\{/)
})
