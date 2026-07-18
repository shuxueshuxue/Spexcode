import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'styles.css'), 'utf8')

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
