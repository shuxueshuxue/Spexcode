import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inboxCommands, uiCommandsFor, UI_COMMANDS } from './sessionCommands.js'

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

test('session eval glance reuses the graph summary projection and review-state visual', () => {
  assert.match(source, /sessionEvalDisplay\(active !== 'new' \? selSession\?\.evalSummary : null, boardLive\)/)
  assert.match(source, /projection\.lastKnown\?\.value/)
  assert.doesNotMatch(source, /\/api\/sessions\/.*\/evals|setTimeout\(load, 15_000\)|useSessionEvalSummary/)
  assert.match(source, /<TabCount kind="eval" state="pass"/)
  assert.match(source, /<TabCount kind="eval" state="fail"/)
  assert.match(source, /<TabCount kind="eval" state="review" cls="st-review secondary"/)
  assert.match(source, /summary\.review > 0/)
  assert.doesNotMatch(feed, /\bn\.evals\b|\bn\.scenarios\b|sessionEvalSummary/)
  assert.match(reviewShell, /review: \{ icon: 'clock', tone: 'review'/)
  assert.match(css, /\.review-state\.review \{ color: var\(--yellow\); \}/)
  assert.match(en, /evalReview: \(\{ n \}\).*stale or unscored and needing review/)
  assert.match(zh, /evalReview: \(\{ n \}\).*需人工复核/)
  assert.match(en, /evalDoorSummary: \(\{ pass, fail, review, blind, unknown \}\)/)
  assert.match(en, /\$\{review\} need review/)
  assert.match(zh, /evalDoorSummary: \(\{ pass, fail, review, blind, unknown \}\)/)
  assert.match(zh, /待人工复核 \$\{review\}/)
  assert.match(source, /<ReviewState kind="eval" state="missing"/)
  assert.doesNotMatch(source, /si-eval-measured|list-checks|session\.evalMeasured/)
  assert.match(source, /summary\.unknown > 0/)
  assert.match(source, /t\('session\.evalUnknown'/)
  assert.match(source, /summary\.phase === 'updating'/)
  assert.match(source, /summary\.phase === 'disconnected'/)
})

test('command availability, icons, toolbar tools, and typed twins remain one registry result', () => {
  const runners = Object.fromEntries(['command', 'eval', 'merge', 'relaunch', 'stop', 'close'].map((name) => [name, () => name]))
  const names = (status, liveness) => uiCommandsFor(status, runners, liveness).map((command) => command.name)
  const typed = (status, liveness) => uiCommandsFor(status, runners, liveness).filter((command) => command.typed !== false).map((command) => command.name)
  const tools = (status, liveness) => uiCommandsFor(status, runners, liveness).filter((command) => command.button).map(({ name, icon }) => [name, icon])

  assert.deepEqual(names('working', 'online'), ['command', 'eval', 'stop', 'close'])
  assert.deepEqual(names('review', 'online'), ['command', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('done', 'online'), ['command', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['eval', 'close'])
  assert.deepEqual(names('asking', 'offline'), ['eval', 'relaunch', 'close'])
  assert.deepEqual(names('review', 'offline'), ['eval', 'relaunch', 'close'])
  assert.deepEqual(typed('asking', 'offline'), ['eval', 'close'])
  assert.deepEqual(tools('review', 'online'), [['command', 'command'], ['merge', 'git-merge']])
  assert.deepEqual(tools('asking', 'offline'), [['relaunch', 'rotate-ccw']])
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').anchor, 'right')
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').typed, false)
  assert.match(source, /uiCommandsFor\(selSession\?\.status, runners, selSession\?\.liveness\)/)
  assert.match(source, /if \(commandAvailable\) setCommandOpen/)
  assert.match(source, /uiCmds\.filter\(\(c\) => c\.button\)[\s\S]*?\.sort\(\(a, b\) => \(a\.anchor === 'right' \? 1 : 0\) - \(b\.anchor === 'right' \? 1 : 0\)\)[\s\S]*?\.map/)
  assert.match(source, /const pressed = c\.pressed \? commandOpen : undefined/)
  assert.match(source, /<IconButton[\s\S]*icon=\{c\.icon\}[\s\S]*aria-pressed=\{pressed\}/)
  assert.match(icons, /command:\s*\{[\s\S]*keyboard:\s*\{[\s\S]*'git-merge':\s*\{[\s\S]*'rotate-ccw':\s*\{/)
})

test('Command Box orders board, preset, then harness commands and deduplicates by precedence', () => {
  const board = [{ name: 'close', ui: true }]
  const presets = [{ name: 'rename', desc: 'Rename this session' }, { name: 'close', desc: 'Wrong twin' }]
  const harness = [{ name: 'rename', description: 'Harness rename' }, { name: 'help', source: 'built-in' }]
  const commands = inboxCommands(board, presets, harness)

  assert.deepEqual(commands.map((command) => command.name), ['close', 'rename', 'help'])
  assert.equal(commands[1].source, 'preset')
  assert.match(source, /inboxCommands\(ui, commandPresets, slashCmds\)/)
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
