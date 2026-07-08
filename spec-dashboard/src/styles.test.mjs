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

test('terminal composer keeps its single-line controls centered in the input box', () => {
  assert.match(
    css,
    /\.si-content\.is-session\s*\{[^}]*--si-dock-h:\s*44px;/s,
  )
  assert.match(
    css,
    /\.si-bottom\s*\{[^}]*left:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*align-items:\s*center;[^}]*min-height:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*border-radius:\s*0;/s,
  )
  assert.match(
    css,
    /\.si-bottom\s+\.si-input\s*\{[^}]*min-height:\s*20px;[^}]*line-height:\s*20px;/s,
  )
  assert.match(
    css,
    /\.si-bottom\s+\.si-attach\s*\{[^}]*align-self:\s*center;/s,
  )
})
