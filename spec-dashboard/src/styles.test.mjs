import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const sessionInterface = readFileSync(join(here, 'SessionInterface.jsx'), 'utf8')

test('evals and issues pages sit flush against the side rail and top edge', () => {
  assert.match(
    css,
    /\.page-evals,\s*\.page-issues\s*\{[^}]*padding:\s*0\s+14px\s+10px\s+0;/s,
  )
})

test('terminal composer docks flush at the bottom and keeps ❯ on the active line', () => {
  assert.match(
    css,
    /\.si-content\.is-session\s*\{[^}]*--si-dock-h:\s*44px;/s,
  )
  // flush-bottom footer: only a top border (no float/inset/radius/side borders), controls anchored to the
  // bottom (active) line via flex-end, so a grown multi-line box keeps ❯ tracking the caret, not mid-box.
  assert.match(
    css,
    /\.si-bottom\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*align-items:\s*flex-end;[^}]*min-height:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*border-top:\s*1px solid var\(--line\);/s,
  )
  assert.match(
    css,
    /\.si-bottom\s+\.si-input\s*\{[^}]*min-height:\s*20px;[^}]*line-height:\s*20px;/s,
  )
  // the paperclip carries NO align-self override, so it inherits the base .si-attach flex-end and tracks
  // the same bottom line as ❯ (the align-items:center override that stranded it mid-box is gone).
  assert.doesNotMatch(
    css,
    /\.si-bottom\s+\.si-attach\s*\{[^}]*align-self:/s,
  )
})

test('headless chat removes the terminal-only dock reserve', () => {
  assert.match(
    sessionInterface,
    /`si-content is-session\$\{isHeadless \? ' is-headless' : ''\}`/,
  )
  assert.match(
    css,
    /\.si-content\.is-session\.is-headless\s*\{[^}]*--si-dock-h:\s*0px;/s,
  )
})

test('projects hub + credential surfaces read the shared palette, never a one-off color', () => {
  // the whole appended [[projects-hub]] block themes itself through the var set — a raw hex literal
  // there would be a palette the eight theme presets cannot re-skin.
  const start = css.indexOf('projects hub ([[projects-hub]])')
  assert.ok(start > 0, 'projects-hub style block present')
  const block = css.slice(start)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/)
  // the health dot maps the gateway's health words onto semantic accents
  assert.match(block, /\.proj-health\.h-running\s*\{\s*background:\s*var\(--green\);/)
  assert.match(block, /\.proj-health\.h-unreachable\s*\{\s*background:\s*var\(--red\);/)
  // the credential card is panel-on-paper like every other card in the app
  assert.match(block, /\.cred-card\s*\{[^}]*background:\s*var\(--panel\);[^}]*border:\s*1px solid var\(--line\);/s)
})
