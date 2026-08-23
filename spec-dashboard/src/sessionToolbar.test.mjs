import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inboxCommands, mergeAvailability, uiCommandsFor, UI_COMMANDS } from './sessionCommands.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const contextMenu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
const selectBar = readFileSync(new URL('./SessionSelectBar.jsx', import.meta.url), 'utf8')
const sessionWindow = readFileSync(new URL('./SessionWindow.jsx', import.meta.url), 'utf8')
const timelineChat = readFileSync(new URL('./TimelineChat.jsx', import.meta.url), 'utf8')
const focus = readFileSync(new URL('./focus.js', import.meta.url), 'utf8')
const feed = readFileSync(new URL('./EvalsFeed.jsx', import.meta.url), 'utf8')
const reviewShell = readFileSync(new URL('./ReviewShell.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const icons = readFileSync(new URL('./icons.jsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')

test('session faces are routed and the console has no second tab rail', () => {
  assert.doesNotMatch(source, /className="si-tabs"|className="si-base-tabs"|className="si-eval-tab"/)
  assert.match(source, /id: 'surface-switcher'/)
  assert.match(source, /id: 'diff-switcher'/)
  assert.match(source, /icon: baseSurface === SESSION_SURFACE_TERMINAL \? 'message-square' : 'terminal'/)
  assert.match(source, /icon: 'file-diff'/)
  assert.doesNotMatch(source, /session-surface-switcher|role="tablist" aria-label=\{label\}/)
  assert.match(source, /surfaceChoices\.length > 1/)
  assert.match(source, /setSessionBaseSurface\(active, next\)/)
  assert.match(source, /showBaseSurface\(active, diffSurface \? getSessionBaseSurface\(active\) : SESSION_SURFACE_DIFF, true\)/)
  assert.match(source, /surface = null/)
  assert.match(source, /const requestedSurface = isSessionSurface\(surface\) \? surface : null/)
  assert.match(source, /const activeBaseSurface = terminalFree \|\| readOnlyPane \? SESSION_SURFACE_CONVERSATION : requestedSurface \|\| getSessionBaseSurface\(active\)/)
  // opening a resource is an ordinary navigation; tabModel turns that address into a pinned file-class
  // hold while preserving the session tab ([[tab-strip]]).
  assert.match(source, /navigate\('sessions', tab\.sessionId, \{ query: \{ surface: resourceSurface\(tab\.id\) \} \}\)/)
  assert.doesNotMatch(source, /requestTab|pinTab/)
  assert.match(source, /const activeResourceId = sessionActive \? requestedResourceId : null/)
  assert.doesNotMatch(source, /role=\{activeResource \? 'dialog'/)
  assert.match(source, /setUnreadResources\(\(unread\) => new Set\(\[\.\.\.unread, \.\.\.added\.map\(\(tab\) => tab\.id\)\]\)\)/)
  assert.doesNotMatch(source, /const selected = admitted\.find\(\(tab\) => tab\.sessionId === active\)/)
  assert.match(source, /SessionDocumentActions document=\{documentKey\}/)
  assert.match(source, /id: 'resource-picker'/)
  assert.doesNotMatch(source, /className="si-tabbar"/)
  assert.match(source, /function SessionResourcePanel\(/)
  assert.doesNotMatch(source, /<aside className=\{`si-list/)
})

test('posted resources use the document-actions picker and selected-file actions', () => {
  assert.match(source, /function ResourceMenu\(\{ options, onOpen \}\)/)
  assert.match(source, /className="si-resource-menu-row" role="menuitem"/)
  assert.match(source, /id: 'download-resource'.*icon: 'download'/)
  assert.match(source, /id: 'copy-resource'.*icon: 'copy'/)
  assert.doesNotMatch(source, /function SessionFiles\(/)
  assert.doesNotMatch(source, /session\.(?:previewFile|downloadFile|filePreviewTitle)', \{ path/)
  assert.match(en, /previewFile: 'preview file'/)
  assert.match(en, /downloadFile: 'download file'/)
  assert.match(zh, /previewFile: '预览文件'/)
  assert.match(zh, /downloadFile: '下载文件'/)
  assert.match(css, /\.document-action-menu\s*\{[^}]*position:\s*absolute;/s)
})

test('file previews use one selectable resource tab, keep Markdown restricted, execute HTML fully, and leave menus quiet', () => {
  assert.match(source, /function FileTextPreview\(\{ path, text \}\) \{[\s\S]*?<RichText className="si-file-markdown">\{text\}<\/RichText>/)
  assert.match(source, /return <iframe className="si-file-html" srcDoc=\{html\} title=\{fileName\(path\)\} \/>/)
  assert.doesNotMatch(source, /className="si-file-html"[^>]*(?:sandbox|referrerPolicy)=/)
  assert.match(source, /const previewKind = response\.headers\.get\('X-Spexcode-Preview-Kind'\)/)
  assert.match(source, /previewKind === 'html' \? 'html' : 'text'/)
  assert.match(source, /preview\.phase === 'html'[\s\S]*?<FileHtmlPreview path=\{tab\.value\} html=\{preview\.text\} \/>/)
  assert.match(source, /className=\{`si-resource-file \$\{preview\.phase\}`\} data-selectable/)
  assert.doesNotMatch(source, /si-file-preview-(?:backdrop|body|head)/)
  assert.match(focus, /const SELECTABLE_PRESS_TARGETS = '\[data-selectable\]'/)
  assert.match(focus, /if \(el\.closest\(SELECTABLE_PRESS_TARGETS\)\) return/)
  assert.match(css, /\.si-resource-file\s*\{[^}]*user-select:\s*text;/s)
  assert.match(css, /\.si-resource-file\.loading, \.si-resource-file\.error, \.si-resource-file\.image\s*\{[^}]*place-items:\s*center;/s)
  assert.match(css, /\.si-file-html\s*\{[^}]*height:\s*100%;[^}]*border:\s*0;/s)
  // the three pop-overs float on the ONE shared elevation ([[typography]]'s --shadow), not three
  // hand-written drops that can drift apart into three different ideas of "above".
  assert.match(css, /\.si-resource-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
  assert.match(css, /\.si-files-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
  assert.match(css, /\.sess-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
})

test('pane-backed and headless consoles share one warm TimelineChat Conversation surface', () => {
  assert.match(source, /const isHeadlessSession = \(session\) => session\?\.capabilities\?\.headless === true/)
  assert.match(source, /\(headless \|\| openedConversations\.has\(id\)\) && \(/)
  assert.match(source, /<TimelineChat s=\{session\} sessions=\{allSessions\} active=\{open && conversationShown\}/)
  assert.match(source, /setOpenedConversations\(\(prev\) => \(prev\.has\(id\) \? prev : new Set\(prev\)\.add\(id\)\)\)/)
  assert.match(timelineChat, /sendSessionText\(s\.id, text, \{ replyVia: 'note' \}\)/)
  assert.equal((timelineChat.match(/className="tl-chat"/g) || []).length, 1)
})

test('live offline and archived conversations share one footer with cold input and polling policy', () => {
  assert.equal((timelineChat.match(/<footer className=/g) || []).length, 1)
  assert.match(timelineChat, /data-footer-state=\{state\}/)
  assert.match(timelineChat, /disabled=\{readOnly\}/)
  assert.match(timelineChat, /data-focus-sink=\{active && !readOnly \? '' : undefined\}/)
  assert.match(timelineChat, /if \(!active \|\| footerState === 'archived'\) return undefined[\s\S]{0,100}setInterval\(load, 8000\)/)
  assert.match(source, /onRestore=\{id === active && session\.status !== 'retired' \? resumeAndReturnToWorking : undefined\}/)
  assert.match(timelineChat, /\{onRestore && <button type="button" className="m-coldline-action"/)
  assert.match(source, /footerState=\{sessionFooterState\(session\)\}/)
  assert.match(source, /const readOnlyPane = noLivePane \|\| archivedSel/)
  assert.doesNotMatch(source, /si-shelf-card|className="si-offline"/)
})

test('archive overlay remains document-side while the duplicate session list is gone', () => {
  assert.match(source, /archiveRequested = false/)
  assert.match(source, /if \(archiveRequested\) setArchiveIndexOpen\(true\)/)
  assert.match(source, /<ArchivePage sessions=\{archivedSessions\}/)
  assert.doesNotMatch(source, /si-list|si-board-scroll|archiveZoneOpen|SessionZone/)
})

test('session tree drag is explicitly retired with the withdrawn document list', () => {
  assert.doesNotMatch(source, /sessionDrag|startSessionDrag|\/api\/sessions\/reparent|data-session-root-drop/)
  assert.doesNotMatch(contextMenu, /onDetach|startSelect|list-checks|corner-up-left/)
  return
/*
  assert.match(source, /const \[sessionDrag, setSessionDrag\] = useState\(null\)/)
  assert.match(source, /apiFetch\('\/api\/sessions\/reparent', \{[\s\S]{0,220}children: \[childId\], parent/)
  assert.match(source, /import \{ SessionConsoleTreeRow, SessionZone, useFold \} from '\.\/SessionWindow\.jsx'/)
  assert.match(source, /data-session-root-drop/)
  assert.match(source, /sessionAncestorIds\(allSessions, target\)\.includes\(drag\.id\)/)
  assert.match(source, /const draggedItem = sessionDrag \? forest\.find\(\(item\) => item\.type === 'row' && item\.s\.id === sessionDrag\.id\) : null/)
  assert.match(source, /<SessionConsoleTreeRow[\s\S]{0,360}item=\{it\}[\s\S]{0,500}onMouseDown: \(e\) => startSessionDrag\(e, s\)/)
  assert.match(source, /\{sessionDrag && draggedItem && \([\s\S]{0,360}<SessionConsoleTreeRow[\s\S]{0,360}item=\{draggedItem\}[\s\S]{0,280}inert/)
  assert.doesNotMatch(source, /sessionDrag\.appearance|sessionDrag\.session|startSessionDrag\(e, s, \{/)
  assert.match(sessionWindow, /export function SessionConsoleTreeRow\(/)
  assert.match(sessionWindow, /<FoldPod \{\.\.\.fold\} inert=\{inert\}/)
  assert.match(source, /onDetach=\{\(s\) => \{ void changeSessionParent\(s\.id, null\) \}\}/)
  assert.match(contextMenu, /menu\.session\.parent && <ContextMenuItem icon="corner-up-left" onClick=\{detach\}>/)
  assert.match(icons, /'corner-up-left':/)
  assert.match(en, /detach: 'remove from parent'/)
  assert.match(en, /rootDrop: 'move to top level'/)
  assert.match(zh, /detach: '解除父级关系'/)
  assert.match(zh, /rootDrop: '移到顶层'/)
  assert.match(css, /\.si-tree-row\.dragging > \.si-item \{ opacity: \.28; \}/)
  assert.match(css, /\.si-tree-row\.drop-target > \.si-item \{/)
  assert.match(css, /\.si-root-drop\.on \{/)
  assert.match(source, /const SESSION_DRAG_GHOST_SCALE = 0\.75/)
  assert.match(source, /'--si-session-drag-ghost-scale': SESSION_DRAG_GHOST_SCALE/)
  assert.match(source, /left: sessionDrag\.x - sessionDrag\.offsetX \* SESSION_DRAG_GHOST_SCALE/)
  assert.match(source, /top: sessionDrag\.y - sessionDrag\.offsetY \* SESSION_DRAG_GHOST_SCALE/)
  assert.match(css, /\.si-session-drag-ghost \{[\s\S]{0,520}z-index: 52;[\s\S]{0,520}pointer-events: none; transform: translate\(10px, -8px\) rotate\(-1deg\) scale\(var\(--si-session-drag-ghost-scale\)\); transform-origin: top left;/)
  assert.doesNotMatch(css, /\.si-session-drag-ghost > \.si-item/)
*/
})

test('archive index is a transient overlay opened by the dock route door', () => {
  assert.match(source, /fetch\(apiUrl\('\/api\/sessions\/archive-index'\)\)/)
  assert.match(source, /if \(archiveRequestRef\.current\) return archiveRequestRef\.current/)
  assert.match(source, /const \[archiveIndexOpen, setArchiveIndexOpen\] = useState\(false\)/)
  assert.match(source, /<ArchivePage sessions=\{archivedSessions\}/)
  assert.match(source, /archiveRequested = false/)
  assert.doesNotMatch(source, /active === 'archive'|is-archive|\[\s*'new',\s*'archive'/)
})

test('offline and archive headers own the disclosure target without nested controls', () => {
  assert.match(sessionWindow, /<button type="button" className=\{classes\} aria-expanded=\{!item\.folded\}/)
  assert.match(sessionWindow, /className="si-zone-count" aria-hidden="true"/)
  assert.doesNotMatch(sessionWindow, /className="si-zone-count"[\s\S]{0,220}aria-expanded/)
  assert.match(source, /onMouseDownCapture=\{inertChromePress\}/)
  assert.match(source, /Native buttons own Enter\/Space activation/)
  assert.match(source, /e\.target\?\.closest\?\.\('button, a\[href\]'\)/)
  assert.doesNotMatch(source, /si-zone-need[^\n]*onClick|si-zone-run[^\n]*onClick/)
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
  assert.doesNotMatch(source, /si-action-error|setActErr|<aside[^>]*>\s*<ActionOutcome/)
})

test('bulk close is retired with multi-select', () => {
  assert.doesNotMatch(source, /SessionSelectBar|const \[selecting|const \[picked|onBulkClosed/)
  return
/*
  assert.match(selectBar, /const body = await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(selectBar, /!response\.ok \|\| body\?\.ok === false/)
  assert.match(selectBar, /onError\?\.\(failures\.join\('\\n'\)\)/)
  assert.match(selectBar, /icon="trash"[\s\S]{0,180}setConfirming\('close'\)/)
  assert.match(selectBar, /`\/api\/sessions\/\$\{id\}\/close`/)
  assert.doesNotMatch(selectBar, /setConfirming\('archive'\)|\/archive/)
  assert.match(source, /<SessionSelectBar[\s\S]{0,300}onError=\{\(message\) => setActionOutcome\(\{ owner: 'panel', phase: 'failed', message \}\)\}/)
*/
})

test('select mode is retired with multi-select', () => {
  assert.doesNotMatch(source, /SessionSelectBar|const \[selecting|const \[picked|startSessionDrag|draggable/)
  return
/*
  assert.match(source, /apiFetch\('\/api\/sessions\/reparent'/)
  assert.match(source, /if \(event\.button !== 0\) return/)
  assert.match(source, /onMouseDown: \(e\) => startSessionDrag\(e, s\)/)
  assert.match(sessionWindow, /\{selecting && <span className=\{`si-check\$\{isPicked \? ' on' : ''\}`/)
  assert.doesNotMatch(source, /reparentDrag|si-drag-handle|draggable/)
  assert.doesNotMatch(css, /si-drag-handle|si-drag-slot|reparent-target/)
  assert.match(css, /\.si-item:has\(> \.si-check\) ~ \.sess-fold-control \{ margin-left: 20px; \}/)
  assert.doesNotMatch(icons, /'grip-vertical':/)
  assert.doesNotMatch(focus, /DRAG_PRESS_TARGETS/)
*/
})

test('close remains the only right-click lifecycle removal and asks for confirmation', () => {
  assert.match(contextMenu, /<ContextMenuItem icon="trash" danger onClick=\{startClose\}>/)
  assert.match(contextMenu, /title=\{t\('sessionWindow\.closeTitle'/)
  assert.doesNotMatch(contextMenu, /startArchive|\/archive`|sessionWindow\.archiveTitle/)
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
  assert.match(source, /sessionEvalDisplay\(sessionActive \? selSession\?\.evalSummary : null, boardLive, !!selSession\)/)
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
  assert.doesNotMatch(en, /session's evaluation[^\n]*merge gates|Evals page[^\n]*merge gates/i)
  assert.doesNotMatch(zh, /评测页[^\n]*合并门禁/)
  assert.match(source, /summary\.phase === 'updating'/)
  assert.match(source, /summary\.phase === 'disconnected'/)
})

test('command availability, icons, toolbar tools, and typed twins remain one registry result', () => {
  const runners = Object.fromEntries(['command', 'eval', 'merge', 'relaunch', 'stop', 'close'].map((name) => [name, () => name]))
  const session = (status, liveness = 'online', proposal = null, archived = false, lifecycle = status === 'review' || status === 'done' || status === 'close-pending' ? 'awaiting' : 'active') => ({ status, liveness, proposal, archived, lifecycle })
  const names = (...args) => uiCommandsFor(session(...args), runners).map((command) => command.name)
  const typed = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.typed !== false && command.enabled).map((command) => command.name)
  const tools = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.button).map(({ name, icon, enabled }) => [name, icon, enabled])

  assert.deepEqual(names('working'), ['command', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('review', 'online', 'merge'), ['command', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('done', 'online', 'nothing'), ['command', 'eval', 'merge', 'stop', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['eval', 'merge', 'close'])
  assert.deepEqual(names('asking', 'offline'), ['eval', 'merge', 'relaunch', 'close'])
  assert.deepEqual(names('retired', 'offline'), ['eval', 'merge', 'close'])
  assert.deepEqual(names('review', 'offline', 'merge'), ['eval', 'merge', 'relaunch', 'close'])
  assert.deepEqual(typed('asking', 'offline'), ['eval', 'close'])
  assert.deepEqual(typed('review', 'online', 'merge'), ['eval', 'merge', 'stop', 'close'])
  assert.deepEqual(tools('review', 'online', 'merge'), [['command', 'command', true], ['merge', 'git-merge', true]])
  assert.deepEqual(tools('done', 'online', 'nothing'), [['command', 'command', true], ['merge', 'git-merge', false]])
  assert.deepEqual(tools('asking', 'offline'), [['merge', 'git-merge', false], ['relaunch', 'rotate-ccw', true]])
  assert.equal(mergeAvailability(session('review', 'online', 'merge')).enabled, true)
  assert.equal(mergeAvailability(session('done', 'online', 'nothing')).disabledTitleKey, 'session.cmd.mergeUnavailableNothing')
  assert.equal(mergeAvailability(session('close-pending', 'online', 'close')).disabledTitleKey, 'session.cmd.mergeUnavailableClose')
  assert.equal(mergeAvailability(session('working')).disabledTitleKey, 'session.cmd.mergeUnavailableNoProposal')
  assert.equal(mergeAvailability(session('review', 'offline', 'merge')).disabledTitleKey, 'session.cmd.mergeUnavailableLiveness')
  // A closed session is always offline and exposes no running-session actions. Its one disabled merge witness
  // keeps the selected-session toolbar slot stable; recovery remains the only actionable archive control.
  assert.deepEqual(names('working', 'online', null, true), ['merge'])
  assert.deepEqual(names('asking', 'offline', null, true), ['merge'])
  assert.equal(mergeAvailability(session('review', 'online', 'merge', true)).disabledTitleKey, 'session.cmd.mergeUnavailableArchived')
  assert.equal(UI_COMMANDS.some((command) => command.name === 'archive' || command.name === 'unarchive'), false)
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').anchor, 'right')
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').typed, false)
  assert.match(source, /uiCommandsFor\(selSession, runners\)/)
  assert.match(source, /if \(commandAvailable\) \{ if \(commandOpen\) closeCommandBox\(\); else setCommandOpen\(true\) \}/)
  assert.match(source, /uiCmds\.filter\(\(command\) => command\.button[\s\S]*?\.map/)
  assert.match(source, /disabledReason: command\.enabled \? undefined : t\(command\.disabledTitleKey\)/)
  assert.match(source, /<SessionDocumentActions document=\{documentKey\} actions=\{documentActions\} \/>/)
  assert.match(css, /\.document-action-button:disabled\s*\{[^}]*cursor:\s*not-allowed;/)
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

test('document-actions slot is compact and owns no identity track', () => {
  assert.match(css, /\.si-session-wrap\s*\{\s*container-type:\s*inline-size;/)
  assert.match(css, /\.tabstrip-actions\s*\{[^}]*margin-left:\s*auto;/s)
  assert.match(css, /\.document-action-button\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s)
  assert.match(css, /\.document-action-menu\s*\{[^}]*position:\s*absolute;/s)
  assert.doesNotMatch(css, /\.si-identity|\.si-th-name|\.si-session-status|\.si-session-live/)
  assert.doesNotMatch(css, /\.si-tabbar\s*\{|\.si-tool\s*\{/)
  assert.doesNotMatch(css, /\.si-list\s*\{|\.si-board-scroll\s*\{|\.si-resizer\s*\{/)
})

assert.ok(here.endsWith('/src/'))
