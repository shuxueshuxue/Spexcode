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
  // The seam is SHORT and shared, not a full-height border on one group. A rule that runs the strip's whole
  // height reads as a structural division of the window when all it separates is two readouts on one row.
  assert.doesNotMatch(css, /\.sb-item:has\(\.sb-launcher-groups\)\s*\{[^}]*border-left/)
  assert.match(css, /\.sb-right \.sb-item \+ \.sb-item::after\s*\{[^}]*height:\s*11px;[^}]*background:\s*var\(--edge\)/s)
  assert.match(css, /\.sb-right \.sb-item \+ \.sb-item::after\s*\{[^}]*right:\s*0;[^}]*top:\s*50%/s)
  // ONE divider voice on the bar: the group border-left is now its only seam. The node ledger's own
  // separator went with the drift door it separated, and no replacement seam style may appear beside it.
  assert.doesNotMatch(css, /\.sb-tally-sep/)
  assert.doesNotMatch(shell, /sb-tally-sep|sb-tally-lead/)
})

// The node ledger is the four STATE counts and nothing else (2026-08-25 ruling). The grand total restated
// their sum and the drift door restated a lint warning; a quiet resting line keeps neither.
test('the node ledger carries the four state counts alone', () => {
  const shell = read('Shell.jsx')
  assert.doesNotMatch(shell, /nodes-total|stats\.totalTitle/)
  assert.doesNotMatch(shell, /data-board-stat="drift"|name="drift"|stats\.driftTitle/)
  assert.match(shell, /STATUS_ORDER\.map\(\(k\) => \(\s*<BoardStat key=\{k\} name=\{`status-\$\{k\}`\}/)
})
