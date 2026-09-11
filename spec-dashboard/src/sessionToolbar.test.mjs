import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inboxCommands, uiCommandsFor, UI_COMMANDS } from './sessionCommands.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const source = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const forest = readFileSync(new URL('./SessionForestPanel.jsx', import.meta.url), 'utf8')
const contextMenu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
const sessionWindow = readFileSync(new URL('./SessionWindow.jsx', import.meta.url), 'utf8')
const timelineChat = readFileSync(new URL('./TimelineChat.jsx', import.meta.url), 'utf8')
const focus = readFileSync(new URL('./focus.js', import.meta.url), 'utf8')
const _documentActions = readFileSync(new URL('./documentActions.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const icons = readFileSync(new URL('./icons.jsx', import.meta.url), 'utf8')
const en = readFileSync(new URL('./i18n/en.js', import.meta.url), 'utf8')
const zh = readFileSync(new URL('./i18n/zh.js', import.meta.url), 'utf8')
const mergePlugin = readFileSync(new URL('../../.spec/spexcode/.plugins/skills/merge/spec.md', import.meta.url), 'utf8')
const mergeTemplate = readFileSync(new URL('../../spec-cli/templates/spec/project/.plugins/skills/merge/spec.md', import.meta.url), 'utf8')

test('session faces are routed and the console has no second tab rail', () => {
  assert.doesNotMatch(source, /className="si-tabs"|className="si-base-tabs"/)
  assert.match(source, /id: 'surface-switcher'/)
  assert.match(source, /id: 'diff-switcher'/)
  assert.match(source, /icon: baseSurface === SESSION_SURFACE_TERMINAL \? 'message-square' : 'terminal'/)
  assert.match(source, /icon: 'git-compare'/)
  assert.doesNotMatch(source, /session-surface-switcher|role="tablist" aria-label=\{label\}/)
  assert.match(source, /surfaceChoices\.length > 1/)
  assert.match(source, /setSessionBaseSurface\(active, next\)/)
  assert.match(source, /showBaseSurface\(active, diffSurface \? getSessionBaseSurface\(active\) : SESSION_SURFACE_DIFF, true\)/)
  assert.match(source, /surface = null/)
  assert.match(source, /const requestedSurface = isSessionSurface\(surface\) \? surface : null/)
  assert.match(source, /const activeBaseSurface = terminalFree \|\| readOnlyPane \? SESSION_SURFACE_CONVERSATION : requestedSurface \|\| getSessionBaseSurface\(active\)/)
  // Opening a resource is a ViewScope-owned address transition; tabModel turns that address into a
  // file-class tab beside the session tab ([[tab-strip]]).
  assert.match(source, /scope\.open\(\{ page: 'sessions', param: tab\.sessionId, query: \{ surface: resourceSurface\(tab\.id\) \} \}\)/)
  assert.doesNotMatch(source, /\bnavigate\s*\(/)
  assert.doesNotMatch(source, /requestTab|openNewTab/)
  assert.match(source, /const activeResourceId = sessionActive \? requestedResourceId : null/)
  assert.match(source, /const renderResourceTabs = activeResource && !resourceTabs\.some\(\(tab\) => tab\.id === activeResource\.id\)/)
  assert.match(source, /\{renderResourceTabs\.map\(\(tab\) => \{/)
  assert.doesNotMatch(source, /role=\{activeResource \? 'dialog'/)
  assert.match(source, /setUnreadResources\(\(unread\) => new Set\(\[\.\.\.unread, \.\.\.added\.map\(\(tab\) => tab\.id\)\]\)\)/)
  assert.doesNotMatch(source, /const selected = admitted\.find\(\(tab\) => tab\.sessionId === active\)/)
  assert.match(source, /SessionDocumentActions document=\{documentKey\}/)
  assert.match(source, /id: 'resource-picker'/)
  assert.doesNotMatch(source, /className="si-tabbar"/)
  assert.match(source, /function SessionResourcePanel\(/)
  assert.match(source, /<SessionForestPanel/)
  assert.doesNotMatch(source, /id: 'session-menu'/)
  assert.match(source, /onSessionContextMenu=\{\(next\) => \{ setResourceMenu\(false\); setCtxMenu\(next\) \}\}/)
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
  assert.match(focus, /const SELECTABLE_PRESS_TARGETS = '\[data-reading-surface\], \[data-selectable\]'/)
  assert.match(focus, /if \(el\.closest\(SELECTABLE_PRESS_TARGETS\)\) return/)
  assert.match(css, /\.si-resource-file\s*\{[^}]*user-select:\s*text;/s)
  assert.match(css, /\.si-resource-file\.loading, \.si-resource-file\.error, \.si-resource-file\.image\s*\{[^}]*place-items:\s*center;/s)
  assert.match(css, /\.si-term-body\.is-resource\s*\{[^}]*background:\s*var\(--paper\);/s)
  assert.match(css, /\.si-file-html\s*\{[^}]*height:\s*100%;[^}]*border:\s*0;/s)
  // the three pop-overs float on the ONE shared elevation ([[typography]]'s --shadow), not three
  // hand-written drops that can drift apart into three different ideas of "above".
  assert.match(css, /\.si-resource-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
  assert.match(css, /\.si-files-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
  assert.match(css, /\.sess-menu\s*\{[^}]*box-shadow:\s*var\(--shadow\);/s)
})

test('pane-backed and headless consoles share one warm TimelineChat Conversation surface', () => {
  assert.match(source, /const isHeadlessSession = \(session\) => session\?\.capabilities\?\.headless === true/)
  assert.match(source, /const next = new Set\(\[\.\.\.prev\]\.filter\(\(id\) => \{[\s\S]*?return session && !isHeadlessSession\(session\) && hasLivePane\(session\)[\s\S]*?\}\)\)/)
  assert.match(source, /\(headless \|\| openedConversations\.has\(id\)\) && \(/)
  assert.match(source, /<TimelineChat s=\{session\} sessions=\{sessionsWithRetention\} active=\{open && conversationShown\}/)
  assert.match(source, /setOpenedConversations\(\(prev\) => \(prev\.has\(id\) \? prev : new Set\(prev\)\.add\(id\)\)\)/)
  assert.match(timelineChat, /sendSessionCommand\(s\.id, text, \{ replyVia: 'note' \}\)/)
  assert.equal((timelineChat.match(/className="tl-chat"/g) || []).length, 1)
})

test('live offline and archived conversations share one footer with coldline and polling policy', () => {
  assert.equal((timelineChat.match(/<footer className=/g) || []).length, 1)
  assert.match(timelineChat, /data-footer-state=\{state\}/)
  assert.match(timelineChat, /editor=\{!readOnly && \(/)
  assert.match(timelineChat, /\{!readOnly && \([\s\S]*className="si-command-tools m-composer-tools"/)
  assert.match(timelineChat, /data-focus-sink=\{active && !readOnly \? '' : undefined\}/)
  assert.doesNotMatch(timelineChat, /disabled=\{readOnly\}/)
  assert.match(timelineChat, /if \(!active \|\| footerState === 'archived'\) return undefined[\s\S]{0,100}setInterval\(load, 8000\)/)
  assert.match(source, /onRestore=\{id === active && session\.status !== 'retired' \? resumeAndReturnToWorking : undefined\}/)
  assert.match(timelineChat, /\{onRestore && <button type="button" className="m-coldline-action"/)
  assert.match(timelineChat, /const restoring = actionOutcome\?\.phase === 'pending'/)
  assert.match(timelineChat, /aria-busy=\{restoring \|\| undefined\}/)
  assert.match(timelineChat, /name=\{restoring \? 'loader' : 'play'\}/)
  assert.match(timelineChat, /actionOutcome\.phase !== 'pending'/)
  assert.match(css, /\.si-attach-busy, \.si-coldline-busy \{[^}]*animation:/)
  assert.match(source, /footerState=\{sessionFooterState\(session\)\}/)
  assert.match(source, /const readOnlyPane = noLivePane \|\| archivedSel/)
  assert.doesNotMatch(source, /si-shelf-card|className="si-offline"/)
})

test('conversation revisit refreshes a warm instance without clearing its rendered state', () => {
  // The window's own position travels with the session, so it is reset here with everything else: an offset,
  // a stamp or a pending anchor carried into a DIFFERENT session would page the wrong history ([[session-timeline]]).
  assert.match(timelineChat, /useEffect\(\(\) => \{\n    setEvents\(null\); setWin\(\{ stamp: null, offset: 0, total: 0, priorWorking: false \}\); setLoadingEarlier\(false\); stampRef\.current = null; anchorRef\.current = null; setDetail\(null\); setCopyStatus\(null\); setSendNote\(null\); setExpandedSeams\(new Set\(\)\); setTranscripts\(new Map\(\)\);[\s\S]*?\n  \}, \[s\.id\]\)/)
  assert.match(timelineChat, /useEffect\(\(\) => \{\n    if \(!active\) return undefined\n    load\(\); loadSessionDetail\(s\.id\)/)
  assert.doesNotMatch(timelineChat, /useEffect\(\(\) => \{\n    if \(!active\) return undefined\n    setEvents\(null\)/)
})

test('archive overlay remains document-side while the Sessions forest is restored', () => {
  assert.match(source, /archiveRequested = false/)
  assert.match(source, /if \(archiveRequested\) setArchiveIndexOpen\(true\)/)
  assert.match(source, /<ArchivePage sessions=\{archivedSessions\}/)
  assert.match(source, /<SessionForestPanel/)
})

test('Sessions owns explicit row selection and complete tree drag', () => {
  assert.match(source, /<SessionForestPanel/)
  assert.match(contextMenu, /onMultiSelect, onDetach/)
  assert.match(contextMenu, /startSelect/)
  assert.match(contextMenu, /corner-up-left/)
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

test('the forest owns the shared keyboard walk and inert chrome boundary', () => {
  assert.match(forest, /import \{ useKeyboardScope \} from '\.\/KeyboardService\.jsx'/)
  assert.match(forest, /import \{ resolveSessionShortcut \} from '\.\/sessionShortcuts\.js'/)
  assert.match(forest, /useKeyboardScope\(\(event\) => \{[\s\S]*?resolveSessionShortcut\(forest, activeId, event\)/)
  assert.match(forest, /<aside[\s\S]*?onMouseDownCapture=\{inertChromePress\}/)
  assert.match(forest, /className="si-resizer" onMouseDownCapture=\{inertChromePress\}/)
  assert.doesNotMatch(source, /resolveSessionShortcut/)
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

test('command availability, icons, toolbar tools, and typed twins remain one registry result', () => {
  const runners = Object.fromEntries(['command', 'relaunch', 'stop', 'close'].map((name) => [name, () => name]))
  const session = (status, liveness = 'online', proposal = null, archived = false, lifecycle = status === 'review' || status === 'done' || status === 'close-pending' ? 'awaiting' : 'active') => ({ status, liveness, proposal, archived, lifecycle })
  const names = (...args) => uiCommandsFor(session(...args), runners).map((command) => command.name)
  const typed = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.typed !== false && command.enabled).map((command) => command.name)
  const tools = (...args) => uiCommandsFor(session(...args), runners).filter((command) => command.button).map(({ name, icon, enabled }) => [name, icon, enabled])

  assert.deepEqual(names('working'), ['command', 'stop', 'close'])
  assert.deepEqual(names('review', 'online', 'merge'), ['command', 'stop', 'close'])
  assert.deepEqual(names('done', 'online', 'nothing'), ['command', 'stop', 'close'])
  assert.deepEqual(names('queued', 'offline'), ['close'])
  assert.deepEqual(names('asking', 'offline'), ['relaunch', 'close'])
  assert.deepEqual(names('retired', 'offline'), ['close'])
  assert.deepEqual(names('review', 'offline', 'merge'), ['relaunch', 'close'])
  assert.deepEqual(typed('asking', 'offline'), ['close'])
  assert.deepEqual(typed('review', 'online', 'merge'), ['stop', 'close'])
  assert.deepEqual(tools('review', 'online', 'merge'), [['command', 'command', true]])
  assert.deepEqual(tools('done', 'online', 'nothing'), [['command', 'command', true]])
  assert.deepEqual(tools('asking', 'offline'), [['relaunch', 'rotate-ccw', true]])
  assert.deepEqual(names('working', 'online', null, true), [])
  assert.deepEqual(names('asking', 'offline', null, true), [])
  assert.equal(UI_COMMANDS.some((command) => command.name === 'merge'), false)
  assert.equal(UI_COMMANDS.some((command) => command.name === 'archive' || command.name === 'unarchive'), false)
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').anchor, 'right')
  assert.equal(UI_COMMANDS.find((c) => c.name === 'command').typed, false)
  assert.match(source, /uiCommandsFor\(selSession, runners\)/)
  assert.match(source, /if \(commandAvailable\) \{ if \(commandOpen\) closeCommandBox\(\); else setCommandOpen\(true\) \}/)
  assert.match(source, /const commandAvailable = !conversationSurface && uiCommandsFor\(selSession, \{\}\)/)
  assert.match(source, /commandOpen && !noLivePane && !conversationSurface/)
  assert.match(source, /uiCmds\.filter\(\(command\) => command\.button[\s\S]*?\.map/)
  assert.match(source, /disabledReason: command\.enabled \? undefined : t\(command\.disabledTitleKey\)/)
  assert.match(source, /<SessionDocumentActions document=\{documentKey\} actions=\{documentActions\} \/>/)
  assert.doesNotMatch(source, /const mergeSession|merge:\s*mergeSession/)
  assert.doesNotMatch(en, /mergeUnavailable/)
  assert.doesNotMatch(zh, /mergeUnavailable/)
  assert.match(icons, /command:\s*\{[\s\S]*keyboard:\s*\{[\s\S]*'rotate-ccw':\s*\{/)
})

test('merge is one present plugin on both the command and skill surfaces', () => {
  for (const body of [mergePlugin, mergeTemplate]) {
    assert.match(body, /surface: skill, command/)
    assert.match(body, /git merge-base --is-ancestor/)
    assert.match(body, /--no-ff/)
    assert.match(body, /Push the source-of-truth branch only after/)
    assert.match(body, /do not call `spex session merge \.` recursively/)
  }
  assert.equal(mergePlugin, mergeTemplate)
})

test('Command Box orders board, preset, then harness commands and deduplicates by precedence', () => {
  const board = [{ name: 'close', ui: true }]
  const presets = [{ name: 'merge', desc: 'Land this session' }, { name: 'rename', desc: 'Rename this session' }, { name: 'close', desc: 'Wrong twin' }]
  const harness = [{ name: 'rename', description: 'Harness rename' }, { name: 'help', source: 'built-in' }]
  const commands = inboxCommands(board, presets, harness)

  assert.deepEqual(commands.map((command) => command.name), ['close', 'merge', 'rename', 'help'])
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
  assert.match(css, /\.si-list\s*\{|\.si-session-scroll\s*\{/)
})

assert.ok(here.endsWith('/src/'))
