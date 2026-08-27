import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./SpecSearch.jsx', import.meta.url), 'utf8')
const nodeView = readFileSync(new URL('./NodeView.jsx', import.meta.url), 'utf8')
const proseTokens = readFileSync(new URL('./proseTokens.js', import.meta.url), 'utf8')
const prose = readFileSync(new URL('./Prose.js', import.meta.url), 'utf8')

test('palette entries carry executable spec and session addresses', () => {
  assert.match(source, /import \{ sessionAddress, specAddress \} from '\.\/address\.js'/)
  assert.match(source, /address: specAddress\(s\.id\)/)
  assert.match(source, /address: sessionAddress\(s\.id\)/)
})

test('spec prose references are real anchors with the new-tab gesture', () => {
  assert.match(nodeView, /const href = routeHash\('spec', id\)/)
  assert.match(nodeView, /<a className="doc-link"[^>]+href=\{href\}[^>]+onClick=\{\(event\) => newTabAnchor\(event, href\)\}/)
})

test('spec prose keeps standard Markdown blocks and links', () => {
  assert.match(proseTokens, /case 'heading_open': return h\(token\.tag/)
  assert.match(proseTokens, /case 'blockquote_open': return h\('blockquote'/)
  assert.match(proseTokens, /className: 'doc-link doc-external'/)
  assert.match(proseTokens, /className: 'doc-image'/)
  assert.match(prose, /renderProseTokens\(tokens/)
})

test('spec prose preserves the remaining standard inline and ordered-list semantics', () => {
  assert.match(proseTokens, /if \(token\.type === 's_open'\)/)
  assert.match(proseTokens, /case 'ordered_list_open': return h\('ol'/)
  assert.match(proseTokens, /case 'list_item_open': return h\('li'/)
  assert.match(proseTokens, /token\.type === 'softbreak'\) current\(\)\.push\(options\.softBreak === 'break'/)
})
