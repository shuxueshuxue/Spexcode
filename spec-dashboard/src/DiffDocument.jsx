import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { apiFetch, sessionUrl } from './data.js'
import { useI18n, useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'

const HIGHLIGHT = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--magenta)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--blue)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--green)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--orange)' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--yellow)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--cyan)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--ink)' },
  { tag: [tags.invalid], color: 'var(--red)' },
])

const THEME = EditorView.theme({
  '&': { backgroundColor: 'var(--paper)', color: 'var(--ink)', fontSize: 'var(--type-meta)', minHeight: '100%' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '8px 0' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none', opacity: '.7' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px' },
  '.cm-line': { whiteSpace: 'pre' },
  '.cm-mergeView': { minWidth: '0' },
}, { dark: true })

const JS_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'])
async function languageFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (!JS_EXT.has(ext)) return []
  try {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ jsx: ext.endsWith('sx'), typescript: ext.startsWith('t') || ext.startsWith('mt') || ext.startsWith('ct') })
  } catch { return [] }
}

// The endpoint deliberately returns bounded unified patches. Project each hunk into two read-only documents so
// CM6 can align the real old/new lines without inventing a second backend transport for this viewer.
export function parseUnifiedPatch(patch) {
  const oldLines = [], newLines = [], oldNumbers = [], newNumbers = []
  let oldNo = 0; let newNo = 0; let inHunk = false
  for (const line of String(patch || '').split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { oldNo = Number(hunk[1]); newNo = Number(hunk[2]); inHunk = true; continue }
    if (!inHunk || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('\\')) continue
    if (line.startsWith('-')) { oldLines.push(line.slice(1)); oldNumbers.push(oldNo++); continue }
    if (line.startsWith('+')) { newLines.push(line.slice(1)); newNumbers.push(newNo++); continue }
    if (line.startsWith(' ')) {
      const value = line.slice(1); oldLines.push(value); newLines.push(value)
      oldNumbers.push(oldNo++); newNumbers.push(newNo++)
    }
  }
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n'), oldNumbers, newNumbers }
}

function numberedLines(numbers) {
  return lineNumbers({ formatNumber: (line) => numbers[line - 1] ? String(numbers[line - 1]) : '' })
}

function readOnlyExtensions(numbers, lang, wrap) {
  return [EditorState.readOnly.of(true), EditorView.editable.of(false), numberedLines(numbers), syntaxHighlighting(HIGHLIGHT), lang, wrap ? EditorView.lineWrapping : [], THEME]
}

const entryKey = (entry) => entry ? `${entry.scope}:${entry.file.path}` : ''
const firstEntry = (data) => (data?.files || []).length ? { scope: 'branch', file: data.files[0] } : (data?.working?.files || []).length ? { scope: 'working', file: data.working.files[0] } : null

function DiffFile({ sessionId, file, scope, comments, open, mode, wrap, onComment, onEdit, onView, onNext, onPrevious }) {
  const t = useT(); const host = useRef(null); const mounted = useRef(null)
  const [patch, setPatch] = useState(file.patch || '')
  const parsed = useMemo(() => parseUnifiedPatch(patch), [patch])

  useEffect(() => {
    if (!open || patch || !file.path) return undefined
    let live = true
    apiFetch(`${sessionUrl(sessionId, 'diff')}?scope=${scope}&path=${encodeURIComponent(file.path)}`, { cache: 'no-store' }).then((res) => res.json()).then((data) => {
      const loaded = scope === 'working' ? data?.working?.files?.[0]?.patch : data?.files?.[0]?.patch
      if (live && typeof loaded === 'string') setPatch(loaded)
    }).catch(() => {})
    return () => { live = false }
  }, [sessionId, file.path, open, patch, scope])

  useEffect(() => {
    if (!open || !host.current || !patch) return undefined
    let live = true
    const mount = async () => {
      const lang = await languageFor(file.path)
      if (!live || !host.current) return
      if (mode === 'split') {
        const merge = new MergeView({
          a: { doc: parsed.oldText, extensions: readOnlyExtensions(parsed.oldNumbers, lang, wrap) },
          b: { doc: parsed.newText, extensions: readOnlyExtensions(parsed.newNumbers, lang, wrap) },
          parent: host.current,
          orientation: 'a-b', highlightChanges: true, gutter: true,
          collapseUnchanged: { margin: 3, minSize: 4 },
          diffConfig: { scanLimit: 5000, timeout: 100 },
        })
        mounted.current = merge; onView(file.path, merge)
      } else {
        const view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: parsed.newText,
            extensions: [...readOnlyExtensions(parsed.newNumbers, lang, wrap), unifiedMergeView({
              original: parsed.oldText, highlightChanges: true, syntaxHighlightDeletions: true,
              mergeControls: false, collapseUnchanged: { margin: 3, minSize: 4 },
              diffConfig: { scanLimit: 5000, timeout: 100 },
            })],
          }),
        })
        mounted.current = view; onView(file.path, view)
      }
    }
    mount()
    return () => { live = false; mounted.current?.destroy(); mounted.current = null; onView(file.path, null) }
  }, [file.path, mode, open, parsed, onView, patch, wrap])

  const chooseLine = (event) => {
    if (event.button !== 0) return
    const line = event.target.closest?.('.cm-line'); if (!line || !host.current?.contains(line)) return
    const editor = line.closest('.cm-editor'); const view = mode === 'split' ? (editor === mounted.current?.a?.dom ? mounted.current.a : mounted.current?.b) : mounted.current
    if (!view) return
    const lineNo = view.state.doc.lineAt(view.posAtDOM(line, 0)).number
    const numbers = mode === 'split' && view === mounted.current.a ? parsed.oldNumbers : parsed.newNumbers
    const target = numbers[lineNo - 1]
    if (target) onComment(target, target)
  }

  return <section className={`diff-file${open ? ' is-open' : ''}`} data-diff-file={file.path} data-diff-scope={scope}>
    <button type="button" className="diff-file-head" aria-expanded={open} onClick={() => onComment(null, null)}><strong>{file.path}</strong><span>{file.status}</span><span>+{file.additions} -{file.deletions}</span>{scope === 'working' && <span className="diff-file-scope">{t('session.diffUncommitted')}</span>}<span className="diff-toolbar-spacer" />{open ? '−' : '+'}</button>
    {open && <><div className="diff-hunk-tools"><button type="button" onClick={onPrevious} aria-label={t('session.diffPrevious')}>↑</button><button type="button" onClick={onNext} aria-label={t('session.diffNext')}>↓</button></div><div className={`diff-editor diff-editor-${mode}${wrap ? ' is-wrap' : ''}`} ref={host} onMouseDown={chooseLine} />
      {comments.map((comment) => <div key={comment.id} className={`diff-comment${comment.sentAt ? ' sent' : ''}`}>
        <span className="diff-comment-line">L{comment.lineStart}{comment.lineEnd !== comment.lineStart ? `-L${comment.lineEnd}` : ''}</span>
        <span>{comment.body}</span>{comment.sentAt && <Icon name="check" size={12} />}<IconButton icon="pencil" size={12} label={t('session.diffEdit')} onClick={() => onEdit(comment)} />
      </div>)}
    </>}
  </section>
}

export default function DiffDocument({ sessionId }) {
  const t = useT(); const { lang } = useI18n(); const views = useRef(new Map())
  const [state, setState] = useState({ phase: 'loading', data: null, error: null }); const [draft, setDraft] = useState(null); const [body, setBody] = useState('')
  const [mode, setMode] = useState('split'); const [wrap, setWrap] = useState(false); const [selected, setSelected] = useState('')
  const registerView = useCallback((key, view) => { if (view) views.current.set(key, view); else views.current.delete(key) }, [])
  // A 409 is the endpoint's structured "this diff is honestly unavailable" state (no branch, or worktree AND
  // branch ref both gone) — a calm product fact, not the red transport-error face.
  const load = () => { setState((current) => ({ ...current, phase: 'loading' })); apiFetch(sessionUrl(sessionId, 'diff'), { cache: 'no-store' }).then(async (res) => { const data = await res.json().catch(() => ({})); if (res.status === 409) { setState({ phase: 'unavailable', data: null, error: null, detail: data?.error || '' }); return } if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`); setState({ phase: 'ready', data, error: null }); setSelected(entryKey(firstEntry(data))) }).catch((error) => setState({ phase: 'error', data: null, error })) }
  useEffect(() => { load(); return () => { views.current.clear() } }, [sessionId])
  const committed = state.data?.files || []; const working = state.data?.working?.files || []
  // One ordered reading list over both scopes: the committed branch first, then what is not committed yet.
  // Every selection, view registration and hunk walk addresses an entry by `scope:path`, because the same
  // path legitimately appears in both scopes (committed once, then edited again).
  const entries = [...committed.map((file) => ({ scope: 'branch', file })), ...working.map((file) => ({ scope: 'working', file }))]
  const comments = state.data?.comments || []; const unsent = comments.filter((comment) => !comment.sentAt).length
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entryKey(entry) === selected))
  const navigateChunk = (direction) => {
    const command = direction > 0 ? goToNextChunk : goToPreviousChunk
    for (let step = 0; step < entries.length; step += 1) {
      const index = (selectedIndex + direction * step + entries.length) % entries.length; const entry = entries[index]; const current = views.current.get(entryKey(entry)); if (!current) continue
      const view = mode === 'split' ? current.b : current
      if (command(view)) { setSelected(entryKey(entry)); return }
    }
  }
  const save = async () => { if (!draft || !body.trim()) return; const entry = entries.find((candidate) => candidate.file.path === draft.filePath) || entries[0]; if (!entry) return; const res = await apiFetch(sessionUrl(sessionId, 'diff-comments'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, filePath: draft.filePath || entry.file.path, body, diffIdentity: entry.file.diffIdentity }) }); if (res.ok) { setDraft(null); setBody(''); load() } }
  const send = async () => { const res = await apiFetch(sessionUrl(sessionId, 'diff-comments', 'send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (res.ok) load() }
  if (state.phase === 'loading') return <div className="diff-state">{t('session.diffLoading')}</div>
  if (state.phase === 'unavailable') return <div className="diff-state diff-unavailable">{t('session.diffUnavailable')}{state.detail ? <code className="diff-oids">{state.detail}</code> : null}</div>
  if (state.phase === 'error') return <div className="diff-state error">{t('session.diffFailed', { message: state.error?.message || String(state.error) })}</div>
  // What the branch itself has to say, decided by the backend's branchState — never inferred from a list length.
  const branchNote = state.data.branchState === 'no-commits'
    ? <div className="diff-state diff-no-commits">{t('session.diffNoCommits')}</div>
    : state.data.branchState === 'merged'
      ? <div className="diff-state diff-merged"><strong>{t('session.diffMerged', { base: state.data.baseRef })}</strong>{state.data.commitUrl ? <a href={state.data.commitUrl} target="_blank" rel="noreferrer">{t('session.diffCommit', { commit: state.data.head })}</a> : <code>{state.data.head}</code>}</div>
      : <div className="diff-state">{t('session.diffEmpty')}</div>
  const group = (scope, list) => list.length > 0 && <Fragment key={scope}>
    <div className="diff-file-group">{t(scope === 'branch' ? 'session.diffGroupCommitted' : 'session.diffGroupUncommitted', { n: list.length })}</div>
    {list.map((file) => { const key = `${scope}:${file.path}`
      return <button type="button" key={key} aria-current={key === selected ? 'true' : undefined} onClick={() => setSelected(key)}><strong>{file.path}</strong><span className="diff-file-status">{file.status} +{file.additions} -{file.deletions}</span></button> })}
  </Fragment>
  return <div className="diff-document" data-diff-document data-branch-state={state.data.branchState} lang={lang}>
    <header className="diff-toolbar"><span className="diff-refs"><Icon name="git-merge" size={14} /><strong>{state.data.branch}</strong><span>→</span><strong>{state.data.baseRef}</strong></span><code className="diff-oids">{state.data.head} → {state.data.base}</code>
      <span className="diff-toolbar-spacer" /><div className="diff-mode" role="group" aria-label={t('session.diffMode')}><button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>{t('session.diffSplit')}</button><button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>{t('session.diffUnified')}</button></div><button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{t('session.diffWrap')}</button>{unsent > 0 && <span>{t('session.diffUnsent', { n: unsent })}</span>}<IconButton icon="send" size={14} label={t('session.diffSend')} disabled={!unsent} onClick={send} />
    </header>
    {!entries.length && branchNote}
    {entries.length > 0 && <>
      {!committed.length && <div className="diff-scope-note">{branchNote}</div>}
      <div className="diff-review-body"><nav className="diff-file-panel" aria-label={t('session.diffFiles')}>{[group('branch', committed), group('working', working)]}</nav>
        <div className="diff-files">{entries.map(({ scope, file }) => { const key = `${scope}:${file.path}`
          return <DiffFile key={`${key}:${file.diffIdentity}`} sessionId={sessionId} file={file} scope={scope} open={key === selected} mode={mode} wrap={wrap} comments={comments.filter((comment) => comment.filePath === file.path)} onView={(path, view) => registerView(key, view)} onNext={() => navigateChunk(1)} onPrevious={() => navigateChunk(-1)} onComment={(start, end) => { if (start == null) { setSelected(key); return } setDraft({ filePath: file.path, lineStart: start, lineEnd: end }); setBody('') }} onEdit={(comment) => { setDraft(comment); setBody(comment.body) }} />
        })}</div></div>
    </>}
    {draft && <div className="diff-comment-compose" role="dialog"><strong>{t('session.diffComment')}</strong><span>{draft.filePath || entries[0]?.file.path}:L{draft.lineStart}</span><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('session.diffCommentPlaceholder')} /><div><button type="button" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button type="button" disabled={!body.trim()} onClick={save}>{t('session.diffCommentSave')}</button></div></div>}
  </div>
}
