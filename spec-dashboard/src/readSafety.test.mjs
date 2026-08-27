import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('live terminals are writable by default and only suspended input asks for confirmation', () => {
  const term = source('./SessionTerm.jsx')
  const session = source('./SessionInterface.jsx')

  assert.match(term, /SessionTerm\([^)]*writable = true/)
  assert.match(term, /disableStdin: !writable/)
  assert.match(term, /!writableRef\.current \|\| !focusedRef\.current/)
  assert.doesNotMatch(session, /enable-terminal-input|writableSession|setWritableSession/)
  assert.match(session, /writable=\{open && terminalShown\}/)
  assert.doesNotMatch(session, /resumeRequired=\{session\.status === 'asking'\}/)
  assert.match(session, /asking.*not proof that the live[\s\S]*TUI is suspended/)
  assert.match(term, /setInputConfirmOpen\(true\)/)
  assert.match(term, /setPendingInput\(realInput\)/)
  assert.match(term, /isTerminalPointerReport[\s\S]*startsWith\('\\x1b\[M'\)/)
  assert.match(term, /isTerminalPointerReport[\s\S]*\^\\x1b\\\[\[0-9;\]\+\[Mm\]\$/)
  assert.match(term, /isTerminalFocusReport\(data\)[\s\S]*?return/)
  assert.match(term, /data === '\\x1b\[I' \|\| data === '\\x1b\[O'/)
  assert.match(term, /export function stripTerminalFocusReports[\s\S]*?data\.replace/)
  assert.match(term, /stripTerminalButtonReports[\s\S]*?charCodeAt\(0\) & 64/)
  assert.match(term, /export function stripTerminalPointerReports[\s\S]*?replace/)
  assert.match(term, /const filtered = stripTerminalButtonReports\(stripTerminalFocusReports\(data\)\)/)
  assert.match(term, /const realInput = stripTerminalPointerReports\(stripTerminalFocusReports\(data\)/)
  assert.match(term, /sendInput\(filtered\)/)
  assert.match(term, /resumeInputConfirm/)
  assert.doesNotMatch(term, /resumeInputConfirm[^\n]*autoFocus/)
})

test('an empty diff names which of the three branch states is true and prints complete git identities', () => {
  const backend = source('../../spec-cli/src/sessions.ts')
  const diff = source('./DiffDocument.jsx')

  assert.match(backend, /branch: wt\.branch, baseRef/)
  assert.match(backend, /merge-base', '--is-ancestor'/)
  assert.match(backend, /commitUrl/)
  // a branch that never authored a commit is ALSO an ancestor of its base, so the state is decided from the
  // fork commit first — ancestry alone cannot tell "landed" from "never committed"
  assert.match(backend, /function forkCommitOf/)
  assert.match(backend, /reflog', 'show'/)
  assert.match(backend, /const authoredNothing = forkCommit \? head === forkCommit : head === resolvedBase/)
  assert.match(backend, /branchState: authoredNothing \? 'no-commits' : ancestor\.ok \? 'merged' : 'open'/)
  // the browser renders the backend's verdict; it never re-derives one from a list length
  assert.match(diff, /data\.branch/)
  assert.match(diff, /data\.baseRef/)
  assert.match(diff, /state\.data\.branchState === 'no-commits'/)
  assert.match(diff, /state\.data\.branchState === 'merged'/)
  assert.match(diff, /data\.commitUrl/)
  assert.doesNotMatch(diff, /mergedIntoBase/)
  assert.match(diff, /@codemirror\/merge/)
  assert.match(diff, /new MergeView/)
  assert.match(diff, /unifiedMergeView/)
  assert.match(diff, /highlightChanges: true/)
  assert.match(diff, /syntaxHighlightDeletions: true/)
  assert.match(diff, /collapseUnchanged/)
  assert.match(diff, /data-diff-file/)
  assert.doesNotMatch(diff, /base\.slice\(0, 8\)/)
  assert.doesNotMatch(diff, /head\.slice\(0, 8\)/)
})

test('the uncommitted half is read from the session\'s own worktree, or honestly marked unreadable', () => {
  const backend = source('../../spec-cli/src/sessions.ts')
  const diff = source('./DiffDocument.jsx')
  const en = source('./i18n/en.js')
  const zh = source('./i18n/zh.js')

  // `root` falls back to the shared main checkout once the worktree is gone; the working tree must NOT,
  // or a landed session would show whoever is working in main as its own uncommitted changes.
  assert.match(backend, /const liveRoot = wt\.path && existsSync\(wt\.path\) \? wt\.path : null/)
  assert.match(backend, /working: \{ readable: !!liveRoot, files: working \}/)
  assert.match(backend, /function workingFiles/)
  // one status + one numstat however dirty the tree is, both read-only: the index a live agent is using
  // must not be touched, which is why untracked files are counted rather than staged
  assert.match(backend, /'status', '--porcelain', '--untracked-files=all'/)
  assert.match(backend, /function untrackedCounts/)
  // an untracked file is invisible to `git diff HEAD` and needs the --no-index rendering
  assert.match(backend, /'--no-index', '--', '\/dev\/null'/)
  assert.match(diff, /scope=\$\{scope\}/)
  assert.match(diff, /data\?\.working\?\.files\?\.\[0\]\?\.patch/)
  assert.match(en, /diffGroupUncommitted:/)
  assert.match(zh, /diffGroupUncommitted:/)
})

test('the changed-file tree uses the VS Code collapse-all action shape', () => {
  const diff = source('./DiffDocument.jsx')
  const icons = source('./icons.jsx')
  const en = source('./i18n/en.js')
  const zh = source('./i18n/zh.js')

  assert.match(diff, /className="diff-file-panel-head"/)
  assert.match(diff, /IconButton icon="collapse-all"/)
  assert.match(diff, /session\.diffCollapseAll/)
  assert.match(diff, /disabled=\{!openDirs\.size\}/)
  assert.match(diff, /onClick=\{\(\) => setOpenDirs\(new Set\(\)\)\}/)
  assert.match(icons, /'collapse-all':/)
  assert.match(en, /diffCollapseAll:/)
  assert.match(zh, /diffCollapseAll:/)
})

test('a gone worktree keeps the diff provable from shared refs, and only a vanished branch is refused — structurally', () => {
  const backend = source('../../spec-cli/src/sessions.ts')
  const diff = source('./DiffDocument.jsx')
  const en = source('./i18n/en.js')
  const zh = source('./i18n/zh.js')

  // the diff anchors at a git root that exists: the live worktree when present, the shared main checkout
  // otherwise; the missing-everywhere case is a ResourceConflict (409 {error, code}), never a raw git ENOENT 500.
  assert.match(backend, /function diffAnchorRoot/)
  assert.match(backend, /existsSync\(wt\.path\)/)
  assert.match(backend, /'diff-unavailable'/)
  assert.match(backend, /diffHeadPair\(root, wt\)/)
  // the browser renders the 409 as a calm localized product state, keeping red for real transport errors
  assert.match(diff, /res\.status === 409/)
  assert.match(diff, /phase: 'unavailable'/)
  assert.match(diff, /session\.diffUnavailable/)
  assert.match(en, /diffUnavailable:/)
  assert.match(zh, /diffUnavailable:/)
})

test('a 502 publishes one global offline state and marks retained tallies stale', () => {
  const data = source('./data.js')
  const root = source('./Root.jsx')
  const evals = source('./EvalsPage.jsx')
  const shell = source('./Shell.jsx')
  const dock = source('./Dock.jsx')

  assert.match(data, /subscribeBackendHealth/)
  assert.match(data, /\[502, 503, 504\]/)
  assert.match(root, /BackendStatusFrame/)
  assert.match(evals, /apiFetch\(apiUrl\(`\/api\/evals\/detail/)
  assert.match(shell, /useBackendHealth/)
  assert.match(shell, /sb-stale/)
  assert.match(dock, /useBackendHealth/)
  assert.match(dock, /dock-stale/)
})

test('Command Box turns a lost response into an explicit retryable outcome', () => {
  const data = source('./data.js')
  const session = source('./SessionInterface.jsx')

  assert.match(data, /COMMAND_DELIVERY_TIMEOUT_MS = 15_000/)
  assert.match(session, /new AbortController\(\)/)
  assert.match(session, /setTimeout\(\(\) => controller\.abort\(\), COMMAND_DELIVERY_TIMEOUT_MS\)/)
  assert.match(session, /signal: controller\.signal/)
  assert.match(session, /controller\.signal\.aborted[\s\S]*outcomeUnconfirmed/)
  assert.match(session, /clearTimeout\(timeout\)/)
})

test('session row focus is navigation-only', () => {
  const view = source('./SessionsView.jsx')
  const tabs = source('./tabs.js')

  assert.match(view, /focusSessionTab\(id, \(held\) => scope\.open\(held\)\)/)
  assert.doesNotMatch(view, /fetch\(|apiUrl\(|markHumanPromptActive|resumeSession/)
  assert.match(tabs, /export function focusSessionTab\(id, open\)/)
  assert.match(tabs, /open\?\.\(held \? \{ \.\.\.route \} : route\)/)
  assert.doesNotMatch(tabs, /markHumanPromptActive|resume|\/api\/sessions/)
})
