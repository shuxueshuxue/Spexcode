import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')
const scroll = read('PageScroll.jsx')
const shell = read('ReviewShell.jsx')
const settings = read('Settings.jsx')
const projects = read('ProjectsPage.jsx')
const dashboard = read('Shell.jsx') + read('GraphView.jsx') + read('views.jsx')
const mobile = read('MobileApp.jsx')
const css = read('styles.css')
const e2e = read('../test/page-scroll.e2e.mjs')

test('one page scroll primitive owns address-keyed restoration', () => {
  assert.match(scroll, /export function PageScroll/)
  assert.match(scroll, /window\.location\.pathname[\s\S]*window\.location\.search[\s\S]*window\.location\.hash/)
  // the prefix carries the PROJECT scope: an address is only an address inside one project, and one gateway
  // origin serves them all ([[dashboard-shell]]'s scopedKey).
  assert.match(scroll, /const STORAGE_PREFIX = `\$\{scopedKey\('spex\.page-scroll'\)\}:`/)
  assert.match(scroll, /sessionStorage\.getItem\(`/)
  assert.match(scroll, /sessionStorage\.setItem\(`/)
  // the key is the PANE's address, not the window's: a hidden mounted document must not re-key onto
  // whatever the reader just opened and write its own position over that document's ([[workspace-shell]]).
  assert.match(scroll, /const key = scrollKey \?\? paneAddress \?\? pageScrollAddress\(\)/)
  assert.match(scroll, /const targetTop = readPosition\(key\)/)
  assert.match(scroll, /element\.scrollTop = Math\.min\(targetTop, maxTop\)/)
  assert.match(scroll, /new MutationObserver/)
  assert.match(scroll, /requestAnimationFrame\(restore\)/)
  assert.match(scroll, /let stableFrames = 0/)
  assert.match(scroll, /if \(maxTop < targetTop\) \{ stableFrames = 0; return \}/)
  assert.match(scroll, /if \(\+\+stableFrames < 2\) frame = requestAnimationFrame\(restore\)/)
  assert.match(scroll, /const snapshot = \(\) => \{\s*stopRestoring\(\)\s*remember\(\)/)
  assert.match(scroll, /element\.addEventListener\('scroll', remember, \{ passive: true \}\)/)
  assert.match(scroll, /element\.addEventListener\('pointerdown', snapshot, true\)/)
  assert.match(scroll, /element\.addEventListener\('wheel', snapshot, \{ passive: true, capture: true \}\)/)
  assert.match(scroll, /element\.addEventListener\('keydown', snapshot, true\)/)
  assert.match(scroll, /let lastTop = targetTop[\s\S]*writePosition\(key, lastTop\)/)
  assert.match(scroll, /element\.removeEventListener\('scroll', remember\)/)
  assert.match(scroll, /className=\{`page-scroll/)
})

test('document pages consume PageScroll while Graph and Sessions keep their own viewports', () => {
  assert.match(shell, /<PageScroll className="lp-page">/)
  assert.match(shell, /<PageScroll className="ds-page">/)
  assert.match(settings, /<PageScroll className="page-settings-scroll">/)
  assert.match(projects, /<PageScroll className="page-projects-scroll">/)
  assert.doesNotMatch(dashboard, /<PageScroll/)
  assert.match(shell, /<PageScroll className="lp-page">[\s\S]*className="rl-content"/)
  assert.match(mobile, /const Settings = lazy[\s\S]*page === 'settings'[\s\S]*<Settings \/>/)

  assert.match(css, /\.page-scroll\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s)
  assert.doesNotMatch(css, /\.lp-page\s*\{[^}]*overflow-[xy]:/s)
  assert.doesNotMatch(css, /\.ds-page\s*\{[^}]*overflow-[xy]:/s)
  assert.doesNotMatch(css, /\.page-projects\s*\{[^}]*overflow-[xy]:/s)
  assert.match(css, /\.page-detail-stack\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.si-term-body\s*\{[^}]*overflow:\s*clip;/s)
  assert.match(css, /\.graph\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

test('recorded viewport scenarios satisfy the e2e-review one-pair-per-directory contract', () => {
  assert.match(e2e, /const scenarioDir = join\(out, name\)/)
  assert.match(e2e, /const videoPath = join\(scenarioDir, `\$\{name\}\.webm`\)/)
  assert.match(e2e, /writeFileSync\(join\(scenarioDir, `\$\{name\}\.timeline\.json`\)/)
})
