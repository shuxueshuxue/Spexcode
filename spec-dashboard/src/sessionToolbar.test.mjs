import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { uiCommandsFor } from './sessionCommands.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('session toolbar separates one Terminal tab from the canonical Eval anchor', () => {
  assert.match(source, /className="si-tabs" role="tablist"/)
  assert.match(source, /role="tab"[\s\S]{0,180}aria-selected="true"/)
  assert.match(source, /className="si-eval-door si-tab-door sc-cyan"/)
  assert.match(source, /className="si-identity" role="group" aria-label=/)
  assert.match(source, /href=\{active !== 'new' \? addressHash\(sessionEvalAddress\(active\)\) : null\}/)
  assert.doesNotMatch(source, /<EvalScopeDoor/)

  const tablistEnd = source.indexOf('</div>', source.indexOf('className="si-tabs" role="tablist"'))
  const door = source.indexOf('className="si-eval-door')
  assert.ok(tablistEnd > 0 && door > tablistEnd, 'the navigation door must stay outside the tablist')
})

test('session eval glance reuses the shared model aggregation and review-state visual', () => {
  assert.match(source, /const entries = currentEntries\(nodes\)/)
  assert.match(source, /setTimeout\(load, 15_000\)/)
  assert.match(source, /entries\.filter\(\(entry\) => entry\.state === 'pass'\)/)
  assert.match(source, /<TabCount kind="eval" state="pass"/)
  assert.match(source, /<TabCount kind="eval" state="fail"/)
  assert.match(source, /<ReviewState kind="eval" state="missing"/)
  assert.match(source, /summary\.measured\}\/\{summary\.total/)
})

test('command availability remains one registry result for buttons and typed twins', () => {
  const runners = Object.fromEntries(['type', 'eval', 'merge', 'stop', 'close'].map((name) => [name, () => name]))
  const names = (status, liveness) => uiCommandsFor(status, runners, liveness).map((command) => command.name)

  assert.deepEqual(names('working', 'online'), ['type', 'eval', 'stop', 'close'])
  assert.deepEqual(names('review', 'online'), ['type', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('done', 'online'), ['type', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['eval', 'close'])
  assert.deepEqual(names('asking', 'offline'), ['eval', 'close'])
  assert.match(source, /uiCommandsFor\(selSession\?\.status, runners, selSession\?\.liveness\)/)
  assert.match(source, /if \(typeAvailable\) setTypeMode/)
  assert.match(source, /uiCmds\.filter\(\(c\) => c\.button\)\.map/)
})

test('toolbar responds to pane width and gives the headline the only flexible track', () => {
  assert.match(css, /\.si-session-wrap\s*\{\s*container-type:\s*inline-size;/)
  assert.match(css, /grid-template-columns:\s*auto minmax\(36px, 1fr\) auto auto/)
  assert.match(css, /\.si-th-name\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s)
  assert.match(css, /@container \(max-width:\s*390px\)/)
  assert.match(css, /\.si-list\s*\{[^}]*max-width:\s*calc\(100% - 280px\);/s)
})

assert.ok(here.endsWith('/src/'))
