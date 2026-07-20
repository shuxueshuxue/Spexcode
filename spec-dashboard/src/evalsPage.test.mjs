import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'EvalsPage.jsx'), 'utf8')
const feed = readFileSync(join(here, 'EvalsFeed.jsx'), 'utf8')
const detail = readFileSync(join(here, 'EventDetail.jsx'), 'utf8')
const shell = readFileSync(join(here, 'ReviewShell.jsx'), 'utf8')
const dashboard = readFileSync(join(here, 'Dashboard.jsx'), 'utf8')

test('board-stable history and review identity preserve or reset the right state', () => {
  assert.match(page, /const history = useMemo\([\s\S]*?\[sessionId, model, node, scenario\],[\s\S]*?\)/)
  assert.match(page, /<EventDetail[^>]*sourceKey=\{sessionId \|\| 'project'\}/)

  const identity = detail.match(/const readingIdentity[\s\S]*?const reviewIdentity[^\n]*/)?.[0] || ''
  assert.match(identity, /viewing\.ts/)
  assert.match(identity, /histIdx/)
  assert.match(identity, /sourceKey/)
  assert.match(identity, /entry\.node/)
  assert.match(identity, /entry\.scenario/)
  assert.match(detail, /<ReplyComposer key=\{reviewIdentity\}/)
})

test('session model failures are distinct from genuine not-found states', () => {
  assert.match(page, /r\.status === 404 \? false : Promise\.reject\(new Error\(`HTTP \$\{r\.status\}`\)\)/)
  assert.match(page, /<EvalsGroup[\s\S]*error=\{error \? t\('sessionEval\.loadFailed'/)
  assert.match(page, /<DetailShell failure=\{t\('sessionEval\.loadFailed'/)
  assert.match(shell, /className="ds-page ds-missing ds-failed" role="alert"/)
})

test('scoped gates are leading content inside the shared ListPage scrollport', () => {
  assert.match(page, /const leading = sessionId \? \([\s\S]*className="se-gates"/)
  assert.match(page, /<EvalsGroup[\s\S]*leading=\{leading\}/)
  assert.match(shell, /<PageScroll className="lp-page">[\s\S]*\{leading\}[\s\S]*className="rl-content"/)
})

test('opening a filer or originator session uses no retired eval-view state', () => {
  const callback = dashboard.match(/const openSession = useCallback\([\s\S]*?\n\s*const startNew/)?.[0] || ''
  assert.match(callback, /setSessionSel\(id\)/)
  assert.match(callback, /navigate\('sessions', id\)/)
  assert.doesNotMatch(callback, /\b(?:setEvalView|evalView)\b/)
})

test('blind eval rows obey every reading-only token and remain inert', async () => {
  // the FUSED path: token text ([[review-query]]) bridged into the one engine ([[review-filters]])
  const { evalFilterModel, tokenFilterState } = await import('./reviewFilters.js')
  const blind = { node: 'alpha', scenario: 'never measured', reading: false }
  const matches = (text) => evalFilterModel([blind], tokenFilterState(text, 'eval'), { sessions: [], defaultKind: 'all' }).shown.length === 1

  assert.equal(matches('is:eval'), true)
  assert.equal(matches('verdict:unscored'), true)
  assert.equal(matches('node:alpha'), true)
  assert.equal(matches('never'), true)
  assert.equal(matches('scope:s-1 state:current'), true)
  assert.equal(matches('state:reviewed'), false)
  assert.equal(matches('evidence:video'), false)
  assert.equal(matches('evidence:image'), false)
  assert.equal(matches('freshness:fresh'), false)
  assert.equal(matches('freshness:stale'), false)
  assert.equal(matches('filer:session-id'), false)
  assert.equal(matches('session:present'), false)
  assert.equal(matches('session:missing'), false)
  assert.equal(matches('verdict:pass'), false)
  assert.equal(matches('node:beta'), false)
  assert.equal(matches('absent'), false)
  assert.equal(matches('frobnicate:xyz'), false)

  const blindRows = feed.slice(feed.indexOf('...shownBlind.map'), feed.indexOf('...shown.map'))
  assert.match(blindRows, /cls: 'se-blind'/)
  assert.doesNotMatch(blindRows, /href:/)
})

test('session unknown coverage stays outside scenario rows and filter counts', () => {
  const scopedRows = page.match(/function sessionRows\(model\)[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(scopedRows, /unknownCoverage/)
  assert.match(page, /sessionEvalSummary\(model\.nodes\)\.unknown/)
  assert.match(page, /className="se-gate bad"[\s\S]*sessionEval\.unknownCoverage/)
  const filterSurface = feed.slice(feed.indexOf('export default function EvalsGroup'))
  assert.doesNotMatch(filterSurface, /unknownCoverage/)
})

test('queueNeighbors splits balanced positional groups with boundary refill', () => {
  // the pure split, evaluated from the page source (behavioral, not a shape regex): strictly
  // positional over the entries' stable order, nearest-to-current first in each group, ~5 total
  // balanced with the forward group taking the odd slot, boundary budget refilling the other side.
  const src = page.match(/export function queueNeighbors[\s\S]*?\n\}/)[0].replace('export ', '')
  const entryKey = (e) => `eval:${e.node}·${e.scenario}`
  const queueNeighbors = new Function('entryKey', `${src}; return queueNeighbors`)(entryKey)
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ node: 'n', scenario: `s${i}` }))
  const key = (i) => `eval:n·s${i}`
  const names = (g) => g.map((e) => e.scenario)

  const mid = queueNeighbors(mk(20), key(10))
  assert.deepEqual(names(mid.prev), ['s9', 's8'])
  assert.deepEqual(names(mid.next), ['s11', 's12', 's13'])
  const first = queueNeighbors(mk(20), key(0))
  assert.deepEqual(names(first.prev), [])
  assert.deepEqual(names(first.next), ['s1', 's2', 's3', 's4', 's5'])
  const last = queueNeighbors(mk(20), key(19))
  assert.deepEqual(names(last.next), [])
  assert.deepEqual(names(last.prev), ['s18', 's17', 's16', 's15', 's14'])
  const nearStart = queueNeighbors(mk(20), key(1))
  assert.deepEqual(names(nearStart.prev), ['s0'])
  assert.deepEqual(names(nearStart.next), ['s2', 's3', 's4', 's5'])
  const nearEnd = queueNeighbors(mk(20), key(18))
  assert.deepEqual(names(nearEnd.next), ['s19'])
  assert.deepEqual(names(nearEnd.prev), ['s17', 's16', 's15', 's14'])
  const tiny = queueNeighbors(mk(3), key(1))
  assert.deepEqual(names(tiny.prev), ['s0'])
  assert.deepEqual(names(tiny.next), ['s2'])
  assert.deepEqual(queueNeighbors(mk(1), key(0)), { prev: [], next: [] })
  assert.deepEqual(queueNeighbors(mk(5), 'eval:n·absent'), { prev: [], next: [] })
})

test('the A/B strip is bounded: a recent window, the current pip always visible, one overflow menu', () => {
  // the window constant + the current-outside-window slot rule
  assert.match(detail, /export const AB_WINDOW = 8/)
  assert.match(detail, /histIdx < AB_WINDOW\s*\n?\s*\? Array\.from\(\{ length: recent \}/)
  assert.match(detail, /\[histIdx, \.\.\.Array\.from\(\{ length: AB_WINDOW - 1 \}/)
  // every non-pip reading reaches the ONE accessible overflow menu (shared popover mechanics)
  assert.match(detail, /function AbOverflow\(/)
  assert.match(detail, /role="menuitemradio" aria-checked=\{r\.idx === histIdx\}/)
  assert.match(detail, /usePopover/)
  // pips wear the shared ReviewState primitive and mark the viewed one for AT + layout alike
  assert.match(detail, /aria-current=\{idx === histIdx \? 'true' : undefined\}/)
  // the strip never wraps — single line at stable height
  const cssText = readFileSync(join(here, 'styles.css'), 'utf8')
  assert.match(cssText, /\.an-ab \{ display: flex; align-items: center; flex-wrap: nowrap;/)
  assert.match(cssText, /\.an-ab-track \{ display: flex; flex-wrap: nowrap;/)
  // phone width: the visible position label yields (aria-labels keep the position readable), so the
  // widest old-index state can never push the strip past the viewport
  assert.match(cssText, /@media \(max-width: 760px\) \{\s*\n\s*\.an-ab-pos \{ display: none; \}\s*\n\}/)
})
