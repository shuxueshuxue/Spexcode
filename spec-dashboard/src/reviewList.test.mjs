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
  assert.match(shell, /const typingControl = tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'/)
  assert.match(shell, /const nativeButtonKey = tag === 'BUTTON' && \(event\.key === 'Enter' \|\| event\.key === ' '\)/)
  assert.match(shell, /if \(typingControl \|\| nativeButtonKey \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.altKey\) return/)
  assert.match(shell, /if \(event\.key !== 'j' && event\.key !== 'k' && event\.key !== 'Enter'\) return/)
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
  const source = shell.match(/export const listEmptyText = ([\s\S]*?\n\))\n\nfunction usePopover/)?.[1]
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
