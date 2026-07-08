import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'styles.css'), 'utf8')

test('evals and issues pages sit flush against the side rail', () => {
  assert.match(
    css,
    /\.page-evals,\s*\.page-issues\s*\{[^}]*padding:\s*10px\s+14px\s+10px\s+0;/s,
  )
})
