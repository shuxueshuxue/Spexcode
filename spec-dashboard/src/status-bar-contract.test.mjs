import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

test('the status bar carries no document source path, and launcher identity stays icon+name', () => {
  const fileView = read('FileView.jsx')
  const shell = read('Shell.jsx')
  const css = read('styles.css')
  // Owner decision (2026-08-24): a routed file's path never rides the bar — the workspace tab and the
  // address already carry the document's identity, and a path item read as ambient noise. The whole
  // file-path item died, not just governance paths, and the governance filter died with it.
  assert.doesNotMatch(fileView, /useStatusItem/)
  assert.doesNotMatch(fileView, /file-path/)
  assert.equal(existsSync(new URL('./fileStatusPath.js', import.meta.url)), false, 'the path filter died with the path item')
  assert.doesNotMatch(shell, /sb-launcher-badge/)
  assert.match(css, /\.sb-right\s*\{[^}]*padding-right:\s*var\(--space-3\)/)
  assert.match(css, /\.sb-item:has\(\.sb-launcher-groups\)\s*\{[^}]*border-left:\s*var\(--divider-rule\)/)
  // ONE divider voice on the bar: the tally separator stretches to the same full-height --edge hairline
  // the launcher group's border-left draws, so the line cannot carry two different seam styles.
  assert.match(css, /\.sb-tally-sep\s*\{[^}]*align-self:\s*stretch;[^}]*background:\s*var\(--edge\);/)
})
