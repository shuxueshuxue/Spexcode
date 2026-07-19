import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')
const shell = read('ReviewShell.jsx')
const evals = read('EvalsFeed.jsx')
const detail = read('EventDetail.jsx')
const issues = read('IssuesPage.jsx')
const css = read('styles.css')
const en = read('i18n/en.js')
const zh = read('i18n/zh.js')

test('issues and evals consume one GitHub ListView primitive set', () => {
  for (const source of [evals, issues]) {
    assert.match(source, /<ListPage/)
    assert.match(source, /<FacetMenu/)
    assert.match(source, /<FacetOverflow/)
    assert.match(source, /<ReviewListRow/)
    assert.doesNotMatch(source, /FilterSelect/)
  }
  const issueList = issues.slice(0, issues.indexOf('export function IssueDetailPage'))
  assert.doesNotMatch(issueList, /<select\b/)
  assert.doesNotMatch(evals, /<select\b/)
  assert.match(shell, /className="rl-query"/)
  assert.match(shell, /className="rl-sections" role="tablist"/)
  assert.match(shell, /className="rl-facets"/)
  assert.match(shell, /className="rl-row-grid"/)
  assert.match(shell, /!listOwnsKey\(event\.target, event\.key\)/)
})

test('shared list key ownership preserves native controls and focused anchors', () => {
  const source = shell.match(/export const listOwnsKey = ([\s\S]*?\n})\n\nconst visibleMenuItems/)?.[1]
  assert.ok(source, 'listOwnsKey stays a directly testable shared predicate')
  const owns = Function(`return (${source})`)()
  const target = (tagName, anchor = false) => ({ tagName, closest: () => (anchor ? {} : null) })

  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(owns(target(tag), 'j'), false)
    assert.equal(owns(target(tag), 'Enter'), false)
  }
  assert.equal(owns(target('BUTTON'), 'Enter'), false)
  assert.equal(owns(target('BUTTON'), ' '), false)
  assert.equal(owns(target('BUTTON'), 'j'), true)
  assert.equal(owns(target('A', true), 'Enter'), false)
  assert.equal(owns(target('SPAN', true), 'Enter'), false)
  assert.equal(owns(target('A', true), 'j'), true)
  assert.equal(owns(target('DIV'), 'Enter'), true)
})

test('facet primitives keep an active missing value clearable', () => {
  const source = shell.match(/export const facetMenuOptions = ([\s\S]*?\n})\n\nexport const rovingIndex/)?.[1]
  assert.ok(source, 'facetMenuOptions stays directly testable')
  const options = Function(`return (${source})`)()
  const all = { value: '', label: 'All' }

  assert.deepEqual(options([], '', 'All'), [])
  assert.deepEqual(options([{ value: 'all', label: 'all' }], 'all', null), [{ value: 'all', label: 'all' }])
  assert.deepEqual(options([], 'dead-session', 'All'), [all])
  assert.deepEqual(options([{ value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.deepEqual(options([all, { value: 'live', label: 'Live' }], 'gone', 'All'), [all, { value: 'live', label: 'Live' }])
  assert.match(evals, /<FacetOverflow[^>]*clearLabel=\{allOption\.label\}/)
  assert.match(evals, /label: t\('reviewList\.facetScope'\), value: query\.session \|\| ''/)
  assert.match(issues, /<FacetOverflow[^>]*clearLabel=\{allOption\.label\}/)
})

test('menus and section tabs share one keyboard and Escape contract', () => {
  const source = shell.match(/export const rovingIndex = ([\s\S]*?\n})\n\nexport const listOwnsKey/)?.[1]
  assert.ok(source, 'rovingIndex stays directly testable')
  const move = Function(`return (${source})`)()
  assert.equal(move(0, 3, 'ArrowDown'), 1)
  assert.equal(move(2, 3, 'ArrowDown'), 0)
  assert.equal(move(0, 3, 'ArrowUp'), 2)
  assert.equal(move(1, 3, 'Home'), 0)
  assert.equal(move(1, 3, 'End'), 2)

  const popover = shell.slice(shell.indexOf('function usePopover'), shell.indexOf('export function FacetMenu'))
  assert.match(popover, /useEscLayer\(open, \(\) => close\(true\)\)/)
  assert.doesNotMatch(popover, /addEventListener\('keydown'/)
  assert.match(popover, /requestAnimationFrame[\s\S]*aria-checked[\s\S]*focusMenuItem/)
  assert.match(popover, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/)
  assert.match(shell, /role="menuitemradio"[\s\S]*tabIndex=\{-1\}/)
  assert.match(shell, /role="tab" aria-selected=\{section\.active\}[\s\S]*tabIndex=\{section\.active \? 0 : -1\}/)
})

test('overflow radio sets and section tabs expose complete ARIA ownership', () => {
  assert.match(shell, /role="group"[\s\S]*aria-labelledby=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /className="rl-menu-label" id=\{`\$\{groupId\}-group-\$\{index\}`\}/)
  assert.match(shell, /role="tablist" aria-label=\{title\} aria-orientation="horizontal"/)
  assert.match(shell, /role="tab" aria-selected=\{section\.active\} aria-controls=\{panelId\}/)
  assert.match(shell, /role="tabpanel" id=\{panelId\} aria-labelledby=\{tabId\(activeSectionIndex\)\}/)

  const tabHandler = shell.slice(shell.indexOf("if (!['ArrowLeft', 'ArrowRight'"), shell.indexOf('tabs[next]?.click()'))
  assert.match(tabHandler, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/)
  assert.doesNotMatch(tabHandler, /ArrowUp|ArrowDown/)
})

test('one icon-label-tone mapping drives every review state home', () => {
  assert.match(shell, /export const REVIEW_STATE_VISUALS = \{[\s\S]*issue:[\s\S]*eval:/)
  assert.match(shell, /open: \{ icon: 'issue-opened', tone: 'open'/)
  assert.match(shell, /closed: \{ icon: 'issue-closed', tone: 'closed'/)
  assert.match(shell, /pass: \{ icon: 'circle-check', tone: 'pass'/)
  assert.match(shell, /fail: \{ icon: 'circle-x', tone: 'fail'/)

  assert.match(evals, /state=\{<ReviewState kind="eval" state=\{e\.state\}/)
  assert.match(issues, /state=\{<ReviewState kind="issue" state=\{status\}/)
  assert.match(issues, /<ReviewState kind="issue" state=\{status\} showLabel/)
  assert.match(detail, /<ReviewState kind="eval" state=\{readingScore\(viewing\)\} showLabel/)
  assert.match(detail, /<ReviewState kind="eval" state=\{state\} size=\{13\}/)
  assert.doesNotMatch(`${evals}\n${detail}`, />\s*[✓✗☑]\s*</)
})

test('responsive ListView matches the measured 32/48/64 desktop and 390px reflow contract', () => {
  assert.match(css, /\.rl-query\s*\{[^}]*height:\s*32px;/s)
  assert.match(css, /\.lp-head\s*\{[^}]*height:\s*48px;/s)
  assert.match(css, /\.rl-row-grid\s*\{[^}]*min-height:\s*64px;/s)
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.lp-head\s*\{[^}]*height:\s*49px;/s)
  assert.match(css, /\.rl-facet-wrap:not\(\.mobile-stay\)\s*\{\s*display:\s*none;/)
  assert.match(css, /\.rl-row-title\s*\{[^}]*-webkit-line-clamp:\s*3;/s)
})

test('shared list empty state distinguishes a vacant dataset from a filtered zero', () => {
  const source = shell.match(/export const listEmptyText = ([\s\S]*?\n\))\n\nexport const facetMenuOptions/)?.[1]
  assert.ok(source, 'listEmptyText stays a directly testable shared primitive')
  const message = Function(`return (${source})`)()
  assert.equal(message({ hasData: false, dataset: 'none yet', filtered: 'no match' }), 'none yet')
  assert.equal(message({ hasData: true, dataset: 'none yet', filtered: 'no match' }), 'no match')
  assert.equal(message('loading'), 'loading')

  assert.match(issues, /hasData: all\.length > 0,[\s\S]*dataset: t\('session\.issuesEmpty'\),[\s\S]*filtered: t\('session\.issuesNoMatch'\)/)
  assert.match(evals, /hasData: entries\.length > 0 \|\| blind\.length > 0,[\s\S]*dataset: t\('evalsFeed\.datasetEmpty'\),[\s\S]*filtered: t\('evalsFeed\.noMatches'\)/)
  for (const messages of [en, zh]) {
    assert.match(messages, /datasetEmpty:/)
    assert.match(messages, /noMatches:/)
    assert.match(messages, /issuesNoMatch:/)
  }
})
