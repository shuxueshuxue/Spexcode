import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./SpecSearch.jsx', import.meta.url), 'utf8')
const nodeView = readFileSync(new URL('./NodeView.jsx', import.meta.url), 'utf8')

test('palette entries carry executable spec and session addresses', () => {
  assert.match(source, /import \{ sessionAddress, specAddress \} from '\.\/address\.js'/)
  assert.match(source, /address: specAddress\(s\.id\)/)
  assert.match(source, /address: sessionAddress\(s\.id\)/)
})

test('spec prose references are real held anchors', () => {
  assert.match(nodeView, /const href = routeHash\('spec', m\[9\]\)/)
  assert.match(nodeView, /<a className="doc-link"[^>]+href=\{href\}[^>]+onClick=\{\(event\) => holdAnchor\(event, href\)\}/)
})

test('spec prose keeps standard Markdown blocks and links', () => {
  assert.match(nodeView, /const Heading = `h\$\{level\}`/)
  assert.match(nodeView, /className=\{`doc-h doc-h-level doc-h\$\{level\}`\}/)
  assert.match(nodeView, /<blockquote className="doc-quote"/)
  assert.match(nodeView, /<a className="doc-link doc-external"/)
  assert.match(nodeView, /<img className="doc-image"/)
})
