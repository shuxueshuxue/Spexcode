import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const attachment = readFileSync(new URL('./SelectionAttachment.jsx', import.meta.url), 'utf8')
const prose = readFileSync(new URL('./ProseActions.jsx', import.meta.url), 'utf8')
const sessions = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('source selection uses one removable attachment producer in both composer homes', () => {
  assert.match(attachment, /export default function SelectionAttachment\(/)
  assert.match(attachment, /className=\{`selection-attachment/)
  assert.match(attachment, /Icon name="file-diff"/)
  assert.match(attachment, /selection-attachment-remove/)
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
