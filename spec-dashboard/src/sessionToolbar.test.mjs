import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { uiCommandsFor } from './sessionCommands.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const feed = readFileSync(new URL('./EvalsFeed.jsx', import.meta.url), 'utf8')
const reviewShell = readFileSync(new URL('./ReviewShell.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const icons = readFileSync(new URL('./icons.jsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')

test('session toolbar separates one Terminal tab from the canonical Eval anchor', () => {
  assert.match(source, /className="si-tabs" role="tablist"/)
  assert.match(source, /role="tab"[\s\S]{0,180}aria-selected="true"/)
  assert.match(source, /className="si-eval-door si-tab-door sc-cyan"/)
  assert.doesNotMatch(source, /si-identity|si-th-name|identitySummary/)
  assert.doesNotMatch(source, /sessionHeadline/)
  assert.match(source, /href=\{active !== 'new' \? addressHash\(sessionEvalAddress\(active\)\) : null\}/)
  assert.doesNotMatch(source, /<EvalScopeDoor/)

  const tablistEnd = source.indexOf('</div>', source.indexOf('className="si-tabs" role="tablist"'))
  const door = source.indexOf('className="si-eval-door')
  assert.ok(tablistEnd > 0 && door > tablistEnd, 'the navigation door must stay outside the tablist')
})

test('session eval glance reuses the shared model aggregation and review-state visual', () => {
  assert.match(source, /sessionEvalDisplay\(active !== 'new' \? selSession\?\.evalSummary : null, boardLive\)/)
  assert.match(source, /projection\.lastKnown\?\.value/)
  assert.doesNotMatch(source, /\/api\/sessions\/.*\/evals|setTimeout\(load, 15_000\)|useSessionEvalSummary/)
  assert.match(source, /<TabCount kind="eval" state="pass"/)
  assert.match(source, /<TabCount kind="eval" state="fail"/)
  assert.match(source, /<TabCount kind="eval" state="review" cls="st-review secondary"/)
  assert.match(source, /summary\.review > 0/)
  assert.match(feed, /review: entries\.length - pass - fail/)
  assert.match(reviewShell, /review: \{ icon: 'clock', tone: 'review'/)
  assert.match(css, /\.review-state\.review \{ color: var\(--yellow\); \}/)
  assert.match(en, /evalReview: \(\{ n \}\).*stale or unscored and needing review/)
  assert.match(zh, /evalReview: \(\{ n \}\).*需人工复核/)
  assert.match(en, /evalDoorSummary: \(\{ measured, total, pass, fail, review, blind, unknown \}\)/)
  assert.match(en, /\$\{review\} need review/)
  assert.match(zh, /evalDoorSummary: \(\{ measured, total, pass, fail, review, blind, unknown \}\)/)
  assert.match(zh, /待人工复核 \$\{review\}/)
  assert.match(source, /<ReviewState kind="eval" state="missing"/)
  assert.match(source, /summary\.measured\}\/\{summary\.total/)
  assert.match(source, /summary\.unknown > 0/)
  assert.match(source, /t\('session\.evalUnknown'/)
  assert.match(source, /summary\.phase === 'updating'/)
  assert.match(source, /summary\.phase === 'disconnected'/)
})

test('command availability, icons, toolbar tools, and typed twins remain one registry result', () => {
  const runners = Object.fromEntries(['type', 'eval', 'merge', 'relaunch', 'stop', 'close'].map((name) => [name, () => name]))
  const names = (status, liveness) => uiCommandsFor(status, runners, liveness).map((command) => command.name)
  const typed = (status, liveness) => uiCommandsFor(status, runners, liveness).filter((command) => command.typed !== false).map((command) => command.name)
  const tools = (status, liveness) => uiCommandsFor(status, runners, liveness).filter((command) => command.button).map(({ name, icon }) => [name, icon])

  assert.deepEqual(names('working', 'online'), ['type', 'eval', 'stop', 'close'])
  assert.deepEqual(names('review', 'online'), ['type', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('done', 'online'), ['type', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['eval', 'close'])
  assert.deepEqual(names('asking', 'offline'), ['eval', 'relaunch', 'close'])
  assert.deepEqual(names('review', 'offline'), ['eval', 'relaunch', 'close'])
  assert.deepEqual(typed('asking', 'offline'), ['eval', 'close'])
  assert.deepEqual(tools('review', 'online'), [['type', 'keyboard'], ['merge', 'git-merge']])
  assert.deepEqual(tools('asking', 'offline'), [['relaunch', 'rotate-ccw']])
  assert.match(source, /uiCommandsFor\(selSession\?\.status, runners, selSession\?\.liveness\)/)
  assert.match(source, /if \(typeAvailable\) setTypeMode/)
  assert.match(source, /uiCmds\.filter\(\(c\) => c\.button\)\.map/)
  assert.match(source, /const pressed = c\.pressed \? typeMode : undefined/)
  assert.match(source, /<IconButton[\s\S]*icon=\{c\.icon\}[\s\S]*aria-pressed=\{pressed\}/)
  assert.match(icons, /keyboard:\s*\{[\s\S]*'git-merge':\s*\{[\s\S]*'rotate-ccw':\s*\{/)
})

test('toolbar is a fixed compact row with no identity track and stable tool geometry', () => {
  assert.match(css, /\.si-session-wrap\s*\{\s*container-type:\s*inline-size;/)
  assert.match(css, /\.si-tabbar\s*\{[^}]*height:\s*32px;[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\)/s)
  assert.doesNotMatch(css, /\.si-identity|\.si-th-name|\.si-session-status|\.si-session-live/)
  assert.match(css, /\.si-tool\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 24px;/s)
  assert.match(css, /\.si-tool:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sc\);[^}]*outline-offset:\s*1px;/s)
  assert.match(css, /@container \(max-width:\s*390px\)/)
  assert.match(css, /\.si-list\s*\{[^}]*max-width:\s*calc\(100% - 280px\);/s)
})

assert.ok(here.endsWith('/src/'))
