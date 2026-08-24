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
  assert.match(term, /setPendingInput\(data\)/)
  assert.match(term, /isTerminalPointerReport[\s\S]*startsWith\('\\x1b\[M'\)/)
  assert.match(term, /isTerminalPointerReport[\s\S]*\^\\x1b\\\[\[0-9;\]\+\[Mm\]\$/)
  assert.match(term, /const pointerReport = isTerminalPointerReport\(data\)[\s\S]*?isTerminalButtonReport\(data\)[\s\S]*?return/)
  assert.match(term, /isTerminalFocusReport\(data\)[\s\S]*?return/)
  assert.match(term, /data === '\\x1b\[I' \|\| data === '\\x1b\[O'/)
  assert.match(term, /resumeInputConfirm/)
  assert.doesNotMatch(term, /resumeInputConfirm[^\n]*autoFocus/)
})

test('an empty diff distinguishes merged work and prints complete git identities', () => {
  const backend = source('../../spec-cli/src/sessions.ts')
  const diff = source('./DiffDocument.jsx')

  assert.match(backend, /branch: wt\.branch, baseRef/)
  assert.match(backend, /merge-base', '--is-ancestor'/)
  assert.match(backend, /mergedIntoBase/)
  assert.match(backend, /commitUrl/)
  assert.match(diff, /data\.branch/)
  assert.match(diff, /data\.baseRef/)
  assert.match(diff, /data\.mergedIntoBase/)
  assert.match(diff, /data\.commitUrl/)
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
