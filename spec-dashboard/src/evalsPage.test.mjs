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
  assert.match(page, /<EventDetail entry=\{entry\} history=\{detail\.history\}/)
  assert.match(page, /<EventDetail[^>]*sourceKey=\{sessionId \|\| 'project'\}/)

  const identity = detail.match(/const readingIdentity[\s\S]*?const reviewIdentity[^\n]*/)?.[0] || ''
  assert.match(identity, /viewing\.ts/)
  assert.match(identity, /histIdx/)
  assert.match(identity, /sourceKey/)
  assert.match(identity, /entry\.node/)
  assert.match(identity, /entry\.scenario/)
  assert.match(detail, /<ReplyComposer key=\{reviewIdentity\}/)
})

test('trunk and scoped list/detail rows use bounded demand endpoints instead of graph or full models', () => {
  assert.match(page, /useReviewPage\('evals', queryText, page, \{ enabled: !param/)
  assert.match(page, /useEvalDetail\(param, sessionId, sessionProjection, !!param\)/)
  assert.match(page, /fetch\(apiUrl\(`\/api\/evals\/detail\?\$\{query\}`\)/)
  assert.doesNotMatch(page, /\/api\/sessions\/\$\{[^}]+\}\/evals`|specUrl\(node, 'evals'\)/)
  assert.doesNotMatch(detail, /specUrl\([^)]*, 'evals'\)|\/api\/specs\/.*\/evals/)
  assert.doesNotMatch(feed, /export function currentEntries/)
  assert.doesNotMatch(feed, /\bn\.evals\b|\bn\.scenarios\b/)
  assert.match(page, /const identity = `\$\{sessionId \|\| ''\}\\0\$\{node\}\\0\$\{scenario\}`/)
  assert.match(page, /const visible = result\.identity === identity \? result : \{ data: null, error: null \}/)
})

test('session model failures are distinct from genuine not-found states', () => {
  assert.match(page, /r\.status === 404 \? false : Promise\.reject\(new Error\(`HTTP \$\{r\.status\}`\)\)/)
  assert.match(page, /<EvalsGroup[\s\S]*error=\{error \? t\('sessionEval\.loadFailed'/)
  assert.match(page, /<DetailShell failure=\{t\('sessionEval\.loadFailed'/)
  assert.match(shell, /className="ds-page ds-missing ds-failed" role="alert"/)
})

test('scoped detail fences epoch, generation, content, and summary before painting', () => {
  const src = page.match(/export function detailMatchesProjection[\s\S]*?\n\}/)[0].replace('export ', '')
  const matches = new Function(`${src}; return detailMatchesProjection`)()
  const summary = { measured: 4, total: 5, pass: 3, fail: 1, review: 0, blind: 1, unknown: 0 }
  const projection = { epoch: 'e', generation: 7, phase: 'ready', revision: 'r', value: summary }
  const detailValue = { evalRevision: { epoch: 'e', generation: 7, content: 'r' }, summary }
  assert.equal(matches(detailValue, projection), true)
  assert.equal(matches({ ...detailValue, summary: { ...summary, blind: 2 } }, projection), false)
  assert.equal(matches({ ...detailValue, evalRevision: { ...detailValue.evalRevision, content: 'old' } }, projection), false)
  assert.equal(matches({ ...detailValue, evalRevision: { ...detailValue.evalRevision, generation: 6 } }, projection), false)
  assert.equal(matches({ ...detailValue, evalRevision: { ...detailValue.evalRevision, generation: 8 } }, projection), true)
  assert.equal(matches({ ...detailValue, evalRevision: { ...detailValue.evalRevision, epoch: 'old' } }, projection), false)
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
  assert.doesNotMatch(page, /function sessionRows\(model\)/)
  assert.match(page, /const unknown = pageData\?\.unknown \|\| 0/)
  assert.match(page, /className="se-gate bad"[\s\S]*sessionEval\.unknownCoverage/)
  const filterSurface = feed.slice(feed.indexOf('export default function EvalsGroup'))
  assert.doesNotMatch(filterSurface, /unknownCoverage/)
})

test('detail queue is a server-bounded projection rather than a client full-dataset computation', () => {
  assert.doesNotMatch(page, /function queueNeighbors|scope\.entries/)
  assert.match(page, /const n = detail\?\.neighbors \|\| \{ prev: \[\], next: \[\] \}/)
  assert.match(page, /prev: n\.prev\.map\(row\), next: n\.next\.map\(row\)/)
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
