import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'styles.css'), 'utf8')
const terminal = readFileSync(join(here, 'SessionTerm.jsx'), 'utf8')

test('dashboard typography declarations use the shared scale', () => {
  const contracts = {
    'font-size': /^var\(--type-/,
    'font-weight': /^var\(--weight-/,
    'line-height': /^var\(--(?:leading|line)-/,
    'letter-spacing': /^var\(--tracking-/,
  }

  for (const [property, token] of Object.entries(contracts)) {
    const values = [...css.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]+)`, 'g'))]
      .map((match) => match[1].trim())
    assert.ok(values.length > 0, `${property} declarations should exist`)
    assert.deepEqual(
      values.filter((value) => !token.test(value)),
      [],
      `${property} must use its shared typography token`,
    )
  }

  assert.match(terminal, /getPropertyValue\('--type-terminal'\)/)
  assert.doesNotMatch(terminal, /fontSize:\s*\d/)
})

test('document pages share one inset page-scroll geometry', () => {
  assert.match(css, /\.page-pane\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*margin:\s*10px 14px 10px 0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s)
  assert.match(css, /\.page-scroll\s*\{[^}]*scrollbar-gutter:\s*stable;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.page-scroll\s*\{[^}]*margin:\s*10px 0;[^}]*scrollbar-gutter:\s*auto;/s)
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
    /\.si-bottom\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*align-items:\s*flex-end;[^}]*min-height:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*border-top:\s*1px solid var\(--line\);[^}]*background-clip:\s*padding-box;/s,
  )
  assert.match(
    css,
    /\.si-bottom\s+\.si-input\s*\{[^}]*min-height:\s*20px;[^}]*line-height:\s*var\(--line-input\);/s,
  )
  // the paperclip carries NO align-self override, so it inherits the base .si-attach flex-end and tracks
  // the same bottom line as ❯ (the align-items:center override that stranded it mid-box is gone).
  assert.doesNotMatch(
    css,
    /\.si-bottom\s+\.si-attach\s*\{[^}]*align-self:/s,
  )
})

test('selected nested session keeps its lead separated from the revealed headline', () => {
  assert.match(
    css,
    /\.si-item\.on\s+\.sess-lead\s*\{[^}]*margin-right:\s*7px;/s,
  )
})

test('projects hub + credential surfaces read the shared palette, never a one-off color', () => {
  // the whole appended [[projects-hub]] block themes itself through the var set — a raw hex literal
  // there would be a palette the eight theme presets cannot re-skin.
  const start = css.indexOf('projects hub ([[projects-hub]])')
  assert.ok(start > 0, 'projects-hub style block present')
  const block = css.slice(start)
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/)
  // the health dot maps the probed health onto semantic accents
  assert.match(block, /\.proj-health\.h-running\s*\{\s*background:\s*var\(--green\);/)
  assert.match(block, /\.proj-health\.h-unreachable\s*\{\s*background:\s*var\(--red\);/)
  // the credential card is panel-on-paper like every other card in the app
  assert.match(block, /\.cred-card\s*\{[^}]*background:\s*var\(--panel\);[^}]*border:\s*1px solid var\(--line\);/s)
})
