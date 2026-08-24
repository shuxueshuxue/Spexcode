import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

test('status bar keeps governance paths out and leaves launcher identity to the icon/name', () => {
  const fileView = read('FileView.jsx')
  const shell = read('Shell.jsx')
  const css = read('styles.css')
  assert.match(fileView, /isGovernancePath\(param\)/)
  assert.doesNotMatch(shell, /sb-launcher-badge/) 
  assert.match(css, /\.sb-right\s*\{[^}]*padding-right:\s*var\(--space-3\)/)
  assert.match(css, /\.sb-item:has\(\.sb-launcher-groups\)\s*\{[^}]*border-left:\s*var\(--divider-rule\)/)
})
