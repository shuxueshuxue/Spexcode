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
const dashboard = read('Dashboard.jsx')
const mobile = read('MobileApp.jsx')
const evalsPage = read('EvalsPage.jsx')
const css = read('styles.css')
const e2e = read('../test/page-scroll.e2e.mjs')

test('one page scroll primitive owns address-keyed restoration', () => {
  assert.match(scroll, /export function PageScroll/)
  assert.match(scroll, /window\.location\.pathname[\s\S]*window\.location\.search[\s\S]*window\.location\.hash/)
  assert.match(scroll, /const STORAGE_PREFIX = 'spex\.page-scroll:'/)
  assert.match(scroll, /sessionStorage\.getItem\(`/)
  assert.match(scroll, /sessionStorage\.setItem\(`/)
  assert.match(scroll, /const targetTop = readPosition\(scrollKey\)/)
  assert.match(scroll, /element\.scrollTop = Math\.min\(targetTop, maxTop\)/)
  assert.match(scroll, /new MutationObserver/)
  assert.match(scroll, /requestAnimationFrame\(restore\)/)
  assert.match(scroll, /element\.addEventListener\('scroll', remember, \{ passive: true \}\)/)
  assert.match(scroll, /element\.addEventListener\('pointerdown', snapshot, true\)/)
  assert.match(scroll, /element\.addEventListener\('wheel', snapshot, \{ passive: true, capture: true \}\)/)
  assert.match(scroll, /element\.addEventListener\('keydown', snapshot, true\)/)
  assert.match(scroll, /let lastTop = targetTop[\s\S]*writePosition\(scrollKey, lastTop\)/)
  assert.match(scroll, /element\.removeEventListener\('scroll', remember\)/)
  assert.match(scroll, /className=\{`page-scroll/)
})

test('document pages consume PageScroll while Graph and Sessions keep their own viewports', () => {
  assert.match(shell, /<PageScroll className="lp-page">/)
  assert.match(shell, /<PageScroll className="ds-page">/)
  assert.match(settings, /<PageScroll className="page-settings-scroll">/)
  assert.match(projects, /<PageScroll className="page-projects-scroll">/)
  assert.doesNotMatch(dashboard, /<PageScroll/)
  assert.match(shell, /<PageScroll className="lp-page">[\s\S]*\{leading\}[\s\S]*className="rl-content"/)
  assert.match(evalsPage, /<EvalsGroup[\s\S]*leading=\{leading\}/)
  assert.match(mobile, /const Settings = lazy[\s\S]*page === 'settings'[\s\S]*<Settings \/>/)

  assert.match(css, /\.page-scroll\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s)
  assert.doesNotMatch(css, /\.lp-page\s*\{[^}]*overflow-[xy]:/s)
  assert.doesNotMatch(css, /\.ds-page\s*\{[^}]*overflow-[xy]:/s)
  assert.doesNotMatch(css, /\.page-projects\s*\{[^}]*overflow-[xy]:/s)
  assert.match(evalsPage, /className="page-detail-stack"/)
  assert.match(css, /\.page-detail-stack\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.si-term-body\s*\{[^}]*overflow:\s*hidden;/s)
  assert.match(css, /\.graph\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
})

test('scoped Evals status stays a non-scrolling sticky child without creating trunk geometry', () => {
  assert.match(css, /\.se-gates\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*4;[^}]*flex:\s*0 0 40px;[^}]*height:\s*40px;/s)
  assert.match(css, /\.se-gates\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);[^}]*background:\s*var\(--panel2\);/s)
  assert.match(css, /\.se-gates\s*~\s*\.rl-content\s+\.lp-head\s*\{\s*top:\s*40px;\s*\}/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.se-gates\s*\{[^}]*flex-basis:\s*80px;[^}]*height:\s*80px;[^}]*\}[\s\S]*\.se-gates\s*~\s*\.rl-content\s+\.lp-head\s*\{\s*top:\s*80px;/s)
  assert.doesNotMatch(css, /\.se-gates\s*\{[^}]*position:\s*fixed;/s)
  assert.doesNotMatch(evalsPage, /sessionId\s*\?\s*\([\s\S]*<PageScroll/)
})

test('recorded viewport scenarios satisfy the e2e-review one-pair-per-directory contract', () => {
  assert.match(e2e, /const scenarioDir = join\(out, name\)/)
  assert.match(e2e, /const videoPath = join\(scenarioDir, `\$\{name\}\.webm`\)/)
  assert.match(e2e, /writeFileSync\(join\(scenarioDir, `\$\{name\}\.timeline\.json`\)/)
})

test('browser proof requires scoped blind rows, real long details, and every themed surface', () => {
  assert.match(e2e, /async function findLongDetail/)
  assert.match(e2e, /best\.scrollHeight > best\.clientHeight \+ 400/)
  assert.match(e2e, /page-scroll-browser-fixture[\s\S]*declared-never-measured/)
  assert.match(e2e, /assert\.equal\(blindRows, 1/)
  assert.match(e2e, /defaultCounts\[0\] \+ defaultCounts\[1\] < scopedTotal/)
  assert.match(e2e, /assert\.deepEqual\(await sectionCounts\(\), reviewCounts/)
  assert.match(e2e, /async function assertScopedStatus/)
  assert.match(e2e, /scoped status stays pinned at the PageScroll inset/)
  assert.match(e2e, /secondary Filters menu stays above the scoped status strip/)
  assert.match(e2e, /scoped Evals Back restores exact list scrollTop/)
  assert.match(e2e, /for \(const \[label, code\] of themes\)[\s\S]*for \(const \[surface, href, selector\] of surfaces\)/)
})
