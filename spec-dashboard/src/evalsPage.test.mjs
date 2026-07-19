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

test('opening a filer or originator session uses no retired eval-view state', () => {
  const callback = dashboard.match(/const openSession = useCallback\([\s\S]*?\n\s*const startNew/)?.[0] || ''
  assert.match(callback, /setSessionSel\(id\)/)
  assert.match(callback, /navigate\('sessions', id\)/)
  assert.doesNotMatch(callback, /\b(?:setEvalView|evalView)\b/)
})

test('blind eval rows obey every reading-only token and remain inert', async () => {
  const source = feed.match(/export const blindMatchesTokens = ([\s\S]*?\n\)\))\n\n\/\//)?.[1]
  assert.ok(source, 'blindMatchesTokens stays a directly testable pure predicate')
  const { effectiveTokens, tokenize } = await import('./reviewQuery.js')
  const predicate = Function('effectiveTokens', `return (${source})`)(effectiveTokens)
  const matches = (blind, text) => predicate(blind, tokenize(text))
  const blind = { node: 'alpha', scenario: 'never measured' }

  assert.equal(matches(blind, 'is:eval state:current'), true)
  assert.equal(matches(blind, 'verdict:unscored'), true)
  assert.equal(matches(blind, 'node:alpha'), true)
  assert.equal(matches(blind, 'never'), true)
  assert.equal(matches(blind, 'scope:s-1 state:current'), true)
  assert.equal(matches(blind, 'state:reviewed'), false)
  assert.equal(matches(blind, 'evidence:video'), false)
  assert.equal(matches(blind, 'evidence:image'), false)
  assert.equal(matches(blind, 'freshness:fresh'), false)
  assert.equal(matches(blind, 'freshness:stale'), false)
  assert.equal(matches(blind, 'filer:session-id'), false)
  assert.equal(matches(blind, 'session:present'), false)
  assert.equal(matches(blind, 'session:missing'), false)
  assert.equal(matches(blind, 'verdict:pass'), false)
  assert.equal(matches(blind, 'node:beta'), false)
  assert.equal(matches(blind, 'absent'), false)
  assert.equal(matches(blind, 'frobnicate:xyz'), false)

  const blindRows = feed.slice(feed.indexOf('...shownBlind.map'), feed.indexOf('...shown.map'))
  assert.match(blindRows, /cls: 'se-blind'/)
  assert.doesNotMatch(blindRows, /href:/)
})
