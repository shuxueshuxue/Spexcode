import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inboxCommands, mergeAvailability, uiCommandsFor, UI_COMMANDS } from './sessionCommands.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const contextMenu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
const sessionWindow = readFileSync(new URL('./SessionWindow.jsx', import.meta.url), 'utf8')
const timelineChat = readFileSync(new URL('./TimelineChat.jsx', import.meta.url), 'utf8')
const focus = readFileSync(new URL('./focus.js', import.meta.url), 'utf8')
const feed = readFileSync(new URL('./EvalsFeed.jsx', import.meta.url), 'utf8')
const reviewShell = readFileSync(new URL('./ReviewShell.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const icons = readFileSync(new URL('./icons.jsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')

test('session toolbar keeps the Terminal tab, adds resource tabs, then Eval and its adjacent picker', () => {
  assert.match(source, /className="si-tabs" role="tablist"/)
  assert.match(source, /role="tab"[\s\S]{0,180}aria-selected=\{!activeResource\}/)
  assert.match(source, /resourceTabs\.filter\(\(tab\) => tab\.sessionId === active\)/)
  assert.match(source, /className="si-resource-picker"/)
  assert.match(source, /const resourceOptions = selSession/)
  assert.match(source, /const knownWebsRef = useRef\(null\)/)
  assert.match(source, /<SessionResourcePanel tab=\{activeResource\}/)
  assert.match(source, /const selectSession = \(id\) => \{[\s\S]{0,260}setSel\(id\)/)
  assert.match(source, /const activateTerminal = \(id\) => \{[\s\S]{0,180}selectSession\(id\)[\s\S]{0,180}setResourceSurface/)
  assert.match(source, /onClick=\{\(\) => \{[\s\S]{0,100}selectSession\(s\.id\)/)
  assert.match(source, /icon="rotate-ccw"[\s\S]{0,160}refreshResource\(tab\)/)
  assert.match(source, /icon="x"[\s\S]{0,160}closeResource\(tab\)/)
  assert.match(source, /className="si-eval-tab sc-cyan"/)
  assert.doesNotMatch(source, /si-identity|si-th-name|identitySummary/)
  assert.doesNotMatch(source, /sessionHeadline/)
  assert.match(source, /href=\{active !== 'new' \? addressHash\(sessionEvalAddress\(active\)\) : null\}/)
  assert.doesNotMatch(source, /<EvalScopeDoor/)

  const tabs = source.indexOf('className="si-tabs" role="tablist"')
  const evalTab = source.indexOf('className="si-eval-tab')
  const picker = source.indexOf('className="si-resource-picker"')
  const actions = source.indexOf('className="si-actions"')
  assert.ok(tabs > 0 && tabs < evalTab && evalTab < picker && picker < actions, 'Eval and the picker must stay adjacent after the resource tab strip')
  assert.match(css, /\.si-tabbar\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s)
  assert.match(css, /\.si-surface\s*\{[^}]*flex:\s*0 1 auto;/s)
  assert.match(css, /\.si-actions\s*\{[^}]*margin-left:\s*auto;/s)
  assert.doesNotMatch(css, /\.si-surface\s*\{[^}]*border-right:/s)
  assert.match(css, /\.si-resource-picker\s*\{[^}]*border-left:\s*1px solid var\(--line\);/s)
  assert.match(css, /\.si-tab-add\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*border-radius:\s*50%;/s)
})

test('file rows keep host paths off the label and reserve that detail for the copy tool', () => {
  assert.match(source, /<span className="si-files-name">\{fileName\(path\)\}<\/span>/)
  assert.doesNotMatch(source, /<span className="si-files-name" data-tip=/)
  assert.match(source, /className="si-files-copy" role="menuitem" label=\{path\}/)
  assert.match(source, /className="si-files-preview" role="menuitem" label=\{t\('session\.previewFile'\)\}/)
  assert.match(source, /className="si-files-download" role="menuitem" label=\{t\('session\.downloadFile'\)\}/)
  assert.match(source, /onClick=\{\(\) => \{ setOpen\(false\); onPreview\(path\) \}\}/)
  assert.doesNotMatch(source, /session\.(?:previewFile|downloadFile|filePreviewTitle)', \{ path/)
  assert.match(en, /previewFile: 'preview file'/)
  assert.match(en, /downloadFile: 'download file'/)
  assert.match(zh, /previewFile: '预览文件'/)
  assert.match(zh, /downloadFile: '下载文件'/)
  assert.match(css, /\.si-files-menu\s*\{[^}]*width:\s*fit-content;/s)
  assert.match(css, /\.si-files-name\s*\{[^}]*max-width:\s*min\(280px, calc\(100vw - 130px\)\);/s)
})

test('file previews use the one selectable resource tab, render Markdown safely, and menus stay quiet', () => {
  assert.match(source, /function FileTextPreview\(\{ path, text \}\) \{[\s\S]*?<RichText className="si-file-markdown">\{text\}<\/RichText>/)
  assert.match(source, /className=\{`si-resource-file \$\{preview\.phase\}`\} data-selectable/)
  assert.doesNotMatch(source, /si-file-preview-(?:backdrop|body|head)/)
  assert.match(focus, /const SELECTABLE_PRESS_TARGETS = '\[data-selectable\]'/)
  assert.match(focus, /if \(el\.closest\(SELECTABLE_PRESS_TARGETS\)\) return/)
  assert.match(css, /\.si-resource-file\s*\{[^}]*user-select:\s*text;/s)
  assert.match(css, /\.si-resource-file\.loading, \.si-resource-file\.error, \.si-resource-file\.image\s*\{[^}]*place-items:\s*center;/s)
  assert.match(css, /\.si-resource-menu\s*\{[^}]*box-shadow:\s*0 2px 8px color-mix\(in srgb, var\(--ink\) 12%, transparent\);/s)
  assert.match(css, /\.si-files-menu\s*\{[^}]*box-shadow:\s*0 2px 8px color-mix\(in srgb, var\(--ink\) 12%, transparent\);/s)
  assert.match(css, /\.sess-menu\s*\{[^}]*box-shadow:\s*0 2px 8px color-mix\(in srgb, var\(--ink\) 12%, transparent\);/s)
})

test('a headless console has one TimelineChat conversation surface', () => {
  assert.match(source, /const isHeadlessSession = \(session\) => session\?\.capabilities\?\.headless === true/)
  assert.match(source, /headless\s*\? <TimelineChat s=\{session\}/)
  assert.match(timelineChat, /sendSessionText\(s\.id, text, \{ replyVia: 'note' \}\)/)
  assert.equal((timelineChat.match(/className="tl-chat"/g) || []).length, 1)
})

test('archive door stays icon-only regardless of archived session count', () => {
  assert.match(source, /className=\{viewingShelf \? 'si-pill shelf on' : 'si-pill shelf'\}/)
  assert.match(source, /name=\{viewingShelf \? 'star-filled' : 'star'\}/)
  assert.doesNotMatch(source, /si-pill-count/)
})

test('archive refresh cannot override a human shelf toggle without a selection transition', () => {
  assert.match(source, /const selectedArchived = active !== 'new'[\s\S]{0,160}\.archived/)
  assert.match(source, /setShowShelf\(selectedArchived\)[\s\S]{0,100}\}, \[open, active, selectedArchived\]\)/)
  assert.doesNotMatch(source, /setShowShelf\(!!allSessions\.find[\s\S]{0,120}\[open, active, allSessions\]/)
})

test('close refusals remain visible instead of being swallowed by the background action', () => {
  assert.match(contextMenu, /const body = await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(contextMenu, /!response\.ok \|\| body\?\.ok === false/)
  assert.match(contextMenu, /onError\?\.\(body\?\.error \|\| `session close refused/)
  assert.match(source, /const j = await res\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /!res\.ok \|\| j\?\.ok === false/)
  assert.match(source, /function ActionOutcome\(\{ outcome \}\)/)
  assert.match(source, /setActionOutcome\(\{ owner, phase: 'failed'/)
  assert.match(source, /onError=\{\(message\) => \{[\s\S]{0,300}setActionOutcome\(\{ owner: 'panel', phase: 'failed', message \}\)/)
  assert.doesNotMatch(source, /si-action-error|setActErr|<aside[^>]*>[\s\S]{0,400}ActionOutcome/)
})

test('only corrupt rows expose the witnessed quarantine control', () => {
  assert.match(contextMenu, /menu\.session\.status === 'corrupt'/)
  assert.match(contextMenu, /<ContextMenuItem icon="archive" onClick=\{startQuarantine\}>\{t\('sessionWindow\.quarantine'\)\}/)
  assert.match(contextMenu, /apiFetch\(`\/api\/sessions\/\$\{quarantining\.id\}\/quarantine`/)
  assert.match(contextMenu, /JSON\.stringify\(\{ \.\.\.witness, thread: witness\.thread\.trim\(\) \|\| null \}\)/)
  for (const key of ['Adapter', 'Thread', 'Tmux', 'Worktree', 'Branch'])
    assert.match(contextMenu, new RegExp(`sessionWindow\\.quarantine${key}`))
  assert.match(contextMenu, /onError\?\.\(body\?\.error \|\| `session quarantine refused/)
  assert.match(en, /quarantine: 'quarantine record'/)
  assert.match(zh, /quarantine: '隔离记录'/)
})

test('cold archive rows render without paying for a git ops projection', () => {
  assert.match(sessionWindow, /if \(!ops\?\.length\) return null/)
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
  const runners = Object.fromEntries(['command', 'eval', 'merge', 'relaunch', 'stop', 'archive', 'close'].map((name) => [name, () => name]))
  const session = (status, liveness = 'online', proposal = null, archived = false, lifecycle = status === 'review' || status === 'done' || status === 'close-pending' ? 'awaiting' : 'active') => ({ status, liveness, proposal, archived, lifecycle })
  const names = (...args) => uiCommandsFor(session(...args), runners).map((command) => command.name)
  const typed = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.typed !== false && command.enabled).map((command) => command.name)
  const tools = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.button).map(({ name, icon, enabled }) => [name, icon, enabled])

  assert.deepEqual(names('working'), ['command', 'eval', 'merge', 'stop', 'archive', 'close'])
  assert.deepEqual(names('review', 'online', 'merge'), ['command', 'eval', 'merge', 'stop', 'archive', 'close'])
  assert.deepEqual(names('done', 'online', 'nothing'), ['command', 'eval', 'merge', 'stop', 'archive', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['eval', 'merge', 'close'])
  assert.deepEqual(names('asking', 'offline'), ['eval', 'merge', 'relaunch', 'archive', 'close'])
  assert.deepEqual(names('review', 'offline', 'merge'), ['eval', 'merge', 'relaunch', 'archive', 'close'])
  assert.deepEqual(typed('asking', 'offline'), ['eval', 'archive', 'close'])
  assert.deepEqual(typed('review', 'online', 'merge'), ['eval', 'merge', 'stop', 'archive', 'close'])
  assert.deepEqual(tools('review', 'online', 'merge'), [['command', 'command', true], ['merge', 'git-merge', true]])
  assert.deepEqual(tools('done', 'online', 'nothing'), [['command', 'command', true], ['merge', 'git-merge', false]])
  assert.deepEqual(tools('asking', 'offline'), [['merge', 'git-merge', false], ['relaunch', 'rotate-ccw', true]])
  assert.equal(mergeAvailability(session('review', 'online', 'merge')).enabled, true)
  assert.equal(mergeAvailability(session('done', 'online', 'nothing')).disabledTitleKey, 'session.cmd.mergeUnavailableNothing')
  assert.equal(mergeAvailability(session('close-pending', 'online', 'close')).disabledTitleKey, 'session.cmd.mergeUnavailableClose')
  assert.equal(mergeAvailability(session('working')).disabledTitleKey, 'session.cmd.mergeUnavailableNoProposal')
  assert.equal(mergeAvailability(session('review', 'offline', 'merge')).disabledTitleKey, 'session.cmd.mergeUnavailableLiveness')
  // A cold archive is always offline and exposes no running-session actions. Its one disabled merge witness
  // keeps the selected-session toolbar slot stable; recovery remains the only actionable archive control.
  assert.deepEqual(names('working', 'online', null, true), ['merge'])
  assert.deepEqual(names('asking', 'offline', null, true), ['merge'])
  assert.equal(mergeAvailability(session('review', 'online', 'merge', true)).disabledTitleKey, 'session.cmd.mergeUnavailableArchived')
  for (const [st, lv] of [['working', 'online'], ['asking', 'offline'], ['queued', 'offline'], ['retired', 'offline'], ['corrupt', 'unknown'], ['review', 'online']]) {
    for (const archived of [false, true]) {
      const offered = names(st, lv, st === 'review' ? 'merge' : null, archived).filter((n) => n === 'archive' || n === 'unarchive')
      assert.deepEqual(offered, archived ? [] : (['queued', 'retired', 'corrupt'].includes(st) ? [] : ['archive']), `${st}/${lv}/archived=${archived}`)
    }
  }
  // neither shelving verb gets a toolbar twin — filing is deliberate, never one pixel from the terminal
  assert.deepEqual(UI_COMMANDS.filter((c) => c.name === 'archive').map((c) => c.button), [false])
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').anchor, 'right')
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').typed, false)
  assert.match(source, /uiCommandsFor\(selSession, runners\)/)
  assert.match(source, /if \(commandAvailable\) \{ if \(commandOpen\) closeCommandBox\(\); else setCommandOpen\(true\) \}/)
  assert.match(source, /uiCmds\.filter\(\(c\) => c\.button\)[\s\S]*?\.sort\(\(a, b\) => \(a\.anchor === 'right' \? 1 : 0\) - \(b\.anchor === 'right' \? 1 : 0\)\)[\s\S]*?\.map/)
  assert.match(source, /const pressed = c\.pressed \? commandOpen : undefined/)
  assert.match(source, /<IconButton[\s\S]*icon=\{c\.icon\}[\s\S]*aria-pressed=\{pressed\}[\s\S]*disabled=\{!c\.enabled\}/)
  assert.match(source, /onClick=\{\(\) => \{ if \(c\.enabled\) c\.run\(\) \}\}/)
  assert.match(css, /\.si-tool:disabled\s*\{[^}]*cursor:\s*not-allowed;/)
  assert.match(en, /mergeUnavailableNothing:.*done --propose nothing/)
  assert.match(zh, /mergeUnavailableNoProposal:.*done --propose merge/)
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
  assert.match(css, /\.si-tabbar\s*\{[^}]*height:\s*32px;[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s)
  assert.match(css, /\.si-tabs\s*\{[^}]*overflow-x:\s*auto;/s)
  assert.match(css, /\.si-resource-tab-main\s*\{[^}]*max-width:\s*180px;/s)
  assert.doesNotMatch(css, /\.si-identity|\.si-th-name|\.si-session-status|\.si-session-live/)
  assert.match(css, /\.si-tool\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 24px;/s)
  assert.match(css, /\.si-tool:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sc\);[^}]*outline-offset:\s*1px;/s)
  assert.match(css, /@container \(max-width:\s*390px\)/)
  assert.match(css, /\.si-list\s*\{[^}]*max-width:\s*calc\(100% - 280px\);/s)
})

assert.ok(here.endsWith('/src/'))
