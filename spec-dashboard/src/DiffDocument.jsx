import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { apiFetch, sessionUrl } from './data.js'
import { useI18n, useT } from './i18n/index.jsx'
import { Caret, Icon, IconButton } from './icons.jsx'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { DiffStat, PathLabel, StatusMark } from './DiffMarks.jsx'
import { Segmented, SegmentedToggle } from './Segmented.jsx'
import { useEscLayer } from './escStack.js'
import { useResizable } from './useResizable.js'
import { buildDiffTree, diffTotals, treeDirKeys } from './diffTree.js'

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

// @codemirror/merge ships a light base theme (a #f3f3f3 fold band, #e43/#2b2 gutter marks, 8%-alpha line
// tints) that no dashboard preset asked for. Every colour it would paint is restated here in the sheet's
// tokens: the `--diff-*` pair for what changed ([[diff-marks]]), the ground ladder for everything else.
// White-space is left to `EditorView.lineWrapping`, so the wrap toggle governs both split panes and the
// unified view the same way.
const THEME = EditorView.theme({
  '&': { backgroundColor: 'var(--paper)', color: 'var(--ink)', fontSize: 'var(--type-meta)', minHeight: '100%' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '8px 0' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px', opacity: '.7', cursor: 'pointer' },
  '.cm-lineNumbers .cm-gutterElement:hover': { color: 'var(--ink2)', opacity: '1' },
  '.cm-line': { cursor: 'text' },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'var(--diff-del-line)' },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: 'var(--diff-add-line)' },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText, &.cm-merge-b .cm-deletedText': { background: 'var(--diff-del-word)' },
  '&.cm-merge-b .cm-changedText': { background: 'var(--diff-add-word)' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--diff-del)' },
  '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--diff-add)' },
  '.cm-collapsedLines': {
    padding: '3px 12px', color: 'var(--muted)', background: 'var(--panel2)', fontFamily: 'var(--ui-font)',
    fontSize: 'var(--type-caption)', borderBlock: '1px solid var(--edge)',
  },
  '.cm-collapsedLines:hover': { color: 'var(--ink2)', background: 'var(--wash-active)' },
  '.cm-collapsedLines:before, .cm-collapsedLines:after': { content: 'none' },
})

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

function numberedLines(numbers, onComment) {
  return lineNumbers({
    formatNumber: (line) => numbers[line - 1] ? String(numbers[line - 1]) : '',
    domEventHandlers: {
      mousedown: (view, line, event) => {
        if (event.button !== 0) return false
        const lineNo = view.state.doc.lineAt(line.from).number
        const target = numbers[lineNo - 1]
        if (!target) return false
        onComment(target, target)
        return true
      },
    },
  })
}

function readOnlyExtensions(numbers, lang, wrap, unchanged, onComment) {
  return [EditorState.readOnly.of(true), EditorView.editable.of(false), numberedLines(numbers, onComment), syntaxHighlighting(HIGHLIGHT), lang,
    wrap ? EditorView.lineWrapping : [], EditorState.phrases.of({ '$ unchanged lines': unchanged }), THEME]
}

const entryKey = (entry) => entry ? `${entry.scope}:${entry.file.path}` : ''
const stillPresent = (data, key) => !!key && [
  ...(data?.files || []).map((file) => `branch:${file.path}`),
  ...(data?.working?.files || []).map((file) => `working:${file.path}`),
].includes(key)
const firstEntry = (data) => (data?.files || []).length ? { scope: 'branch', file: data.files[0] } : (data?.working?.files || []).length ? { scope: 'working', file: data.working.files[0] } : null

function DiffFile({ sessionId, file, scope, comments, open, mode, wrap, onComment, onEdit, onRetract, onView, onNext, onPrevious }) {
  const t = useT(); const host = useRef(null); const mounted = useRef(null)
  const onCommentRef = useRef(onComment)
  onCommentRef.current = onComment
  const [patch, setPatch] = useState(file.patch || '')
  const parsed = useMemo(() => parseUnifiedPatch(patch), [patch])
  // the fold band's words are CodeMirror's phrase; `$` is where it puts the count
  const unchanged = t('session.diffUnchangedLines', { n: '$' })

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
          a: { doc: parsed.oldText, extensions: readOnlyExtensions(parsed.oldNumbers, lang, wrap, unchanged, (start, end) => onCommentRef.current(start, end)) },
          b: { doc: parsed.newText, extensions: readOnlyExtensions(parsed.newNumbers, lang, wrap, unchanged, (start, end) => onCommentRef.current(start, end)) },
          parent: host.current,
          orientation: 'a-b', highlightChanges: true, gutter: true,
          // The endpoint already pays for 40 lines of context per hunk; collapsing to three of them threw
          // away what it fetched and left a reader guessing at the code around the change — the complaint
          // reviewers make about every diff surface. Keep ten on each side and fold only longer runs.
          collapseUnchanged: { margin: 10, minSize: 12 },
          diffConfig: { scanLimit: 5000, timeout: 100 },
        })
        mounted.current = merge; onView(file.path, merge)
      } else {
        const view = new EditorView({
          parent: host.current,
          state: EditorState.create({
            doc: parsed.newText,
            extensions: [...readOnlyExtensions(parsed.newNumbers, lang, wrap, unchanged, (start, end) => onCommentRef.current(start, end)), unifiedMergeView({
              original: parsed.oldText, highlightChanges: true, syntaxHighlightDeletions: true,
              mergeControls: false, collapseUnchanged: { margin: 10, minSize: 12 },
              diffConfig: { scanLimit: 5000, timeout: 100 },
            })],
          }),
        })
        mounted.current = view; onView(file.path, view)
      }
    }
    mount()
    return () => { live = false; mounted.current?.destroy(); mounted.current = null; onView(file.path, null) }
  }, [file.path, mode, open, parsed, onView, patch, wrap, unchanged])

  // The header STAYS while the diff scrolls, because the one thing a reader loses inside a long hunk is
  // which file they are in. Its path spends the row's width; the tally, the status, and the hunk steppers
  // sit at the end in the same order a tree row shows them.
  return <section className="diff-file" data-diff-file={file.path} data-diff-scope={scope}>
    <header className="diff-file-head">
      <PathLabel path={file.path} data-tip={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} />
      {scope === 'working' && <span className="diff-file-scope">{t('session.diffUncommitted')}</span>}
      <DiffStat additions={file.additions} deletions={file.deletions} />
      <StatusMark status={file.status} />
      <span className="diff-hunk-tools">
        <IconButton icon="chevron-up" size={14} className="icon-btn" label={t('session.diffPrevious')} onClick={onPrevious} />
        <IconButton icon="chevron-down" size={14} className="icon-btn" label={t('session.diffNext')} onClick={onNext} />
      </span>
    </header>
    <div className="diff-editor" ref={host} data-reading-surface />
    {comments.length > 0 && <div className="diff-comments">{comments.map((comment) => <div key={comment.id} className={`diff-comment${comment.sentAt ? ' sent' : ''}`}>
      <span className="diff-comment-line">L{comment.lineStart}{comment.lineEnd !== comment.lineStart ? `-L${comment.lineEnd}` : ''}</span>
      <span className="diff-comment-body">{comment.body}</span>{comment.sentAt && <Icon name="check" size={12} />}
      <IconButton icon="pencil" size={12} className="icon-btn" label={t('session.diffEdit')} onClick={() => onEdit(comment)} />
      <IconButton icon="trash" size={12} className="icon-btn" label={t('session.diffRetract')} onClick={() => onRetract(comment)} />
    </div>)}</div>}
  </section>
}

// One row per directory and per changed file, drawn in the explorer's own row grammar ([[file-tree]]) so the
// panel reads like the rest of this product's trees rather than a fourth way of drawing a hierarchy. A
// collapsed chain (`a/b/c`) is a path, so it gives at its front like every other path label.
function TreeRows({ nodes, depth, prefix, scope, selected, openDirs, onToggleDir, onSelect }) {
  const indent = { paddingLeft: 6 + depth * 11 }
  return nodes.map((node) => {
    if (node.kind === 'dir') {
      const key = prefix ? `${prefix}/${node.name}` : node.name
      const open = openDirs.has(key)
      return <Fragment key={`d:${key}`}>
        <button type="button" className="ft-row ft-dir" style={indent} aria-expanded={open} data-tip={key} onClick={() => onToggleDir(key)}>
          <span className="ft-caret"><Caret open={open} /></span>
          <span className="ft-label"><PathLabel path={node.name} /></span>
        </button>
        {open && <TreeRows nodes={node.children} depth={depth + 1} prefix={key} scope={scope}
          selected={selected} openDirs={openDirs} onToggleDir={onToggleDir} onSelect={onSelect} />}
      </Fragment>
    }
    const key = `${scope}:${node.file.path}`
    return <button type="button" key={`f:${key}`} className={`ft-row ft-code diff-tree-file${key === selected ? ' on' : ''}`}
      style={indent} aria-current={key === selected ? 'true' : undefined} data-tip={node.file.path} onClick={() => onSelect(key)}>
      <span className="ft-caret" />
      <span className="ft-label">{node.name}</span>
      <DiffStat additions={node.file.additions} deletions={node.file.deletions} />
      <StatusMark status={node.file.status} />
    </button>
  })
}

// A line comment is written in the product's one composer shell ([[composer]]), floated like the prose send
// card: Enter saves and Shift+Enter breaks the line, the grammar every message home here speaks, and Escape
// peels this card before anything behind it.
function CommentComposer({ path, draft, body, onBody, onCancel, onSave }) {
  const t = useT()
  useEscLayer(true, onCancel)
  const lines = `L${draft.lineStart}${draft.lineEnd !== draft.lineStart ? `–L${draft.lineEnd}` : ''}`
  return <ComposerSurface className="pa-card diff-comment-compose" role="dialog" aria-label={t('session.diffComment')}
    preview={<div className="diff-compose-where"><PathLabel path={path} data-tip={path} /><span className="diff-compose-lines">{lines}</span></div>}
    editor={<ComposerTextarea autoFocus className="pa-message" rows={2} value={body} placeholder={t('session.diffCommentPlaceholder')}
      onChange={(event) => onBody(event.target.value)}
      onKeyDown={(event) => { if (composingKey(event)) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSave() } }} />}
    footer={<div className="pa-foot">
      <button type="button" className="pa-btn" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" className="pa-btn pa-go" disabled={!body.trim()} onClick={onSave}>{t('session.diffCommentSave')}</button>
    </div>} />
}

export default function DiffDocument({ sessionId }) {
  const t = useT(); const { lang } = useI18n(); const views = useRef(new Map())
  const [state, setState] = useState({ phase: 'loading', data: null, error: null }); const [draft, setDraft] = useState(null); const [body, setBody] = useState('')
  const [mode, setMode] = useState('unified'); const [wrap, setWrap] = useState(true); const [selected, setSelected] = useState('')
  const [openDirs, setOpenDirs] = useState(() => new Set())
  // the file panel is a pane like the explorer: one resize mechanism ([[resizable-panes]]), so a reader with
  // deep paths widens it instead of reading clipped names
  const [panelWidth, onPanelDrag, resetPanel] = useResizable('spex.diffPanelWidth', 300, { min: 200, max: 640 })
  const registerView = useCallback((key, view) => { if (view) views.current.set(key, view); else views.current.delete(key) }, [])
  // A 409 is the endpoint's structured "this diff is honestly unavailable" state (no branch, or worktree AND
  // branch ref both gone) — a calm product fact, not the red transport-error face.
  const load = () => { setState((current) => ({ ...current, phase: 'loading' })); apiFetch(sessionUrl(sessionId, 'diff'), { cache: 'no-store' }).then(async (res) => { const data = await res.json().catch(() => ({})); if (res.status === 409) { setState({ phase: 'unavailable', data: null, error: null, detail: data?.error || '' }); return } if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`); setState({ phase: 'ready', data, error: null })
    // A reload is not a navigation: saving or sending a comment re-reads the payload, and resetting the
    // selection there would throw the reader back to the first file — away from the very comment they just
    // filed, which is where its delivery marker appears. Keep the open file whenever it still exists.
    setSelected((current) => stillPresent(data, current) ? current : entryKey(firstEntry(data)))
    // A review wants the whole tree in view; the compressed chains keep that a short list, and a reader
    // who wants less closes what they do not need.
    setOpenDirs(new Set([...treeDirKeys(buildDiffTree(data.files || [])), ...treeDirKeys(buildDiffTree(data.working?.files || []))]))
  }).catch((error) => setState({ phase: 'error', data: null, error })) }
  useEffect(() => { load(); return () => { views.current.clear() } }, [sessionId])
  const committed = state.data?.files || []; const working = state.data?.working?.files || []
  // One ordered reading list over both scopes, addressed by `scope:path` because the same path legitimately
  // appears in both (committed once, then edited again). The tree is the VIEW of this list, not a second one.
  const entries = [...committed.map((file) => ({ scope: 'branch', file })), ...working.map((file) => ({ scope: 'working', file }))]
  const comments = state.data?.comments || []; const unsent = comments.filter((comment) => !comment.sentAt).length
  const current = entries.find((entry) => entryKey(entry) === selected) || entries[0] || null
  // The current file object is refreshed with the board, but its identity key is not. Keep the registration
  // callback keyed to that stable address so a live parent render cannot look like an editor configuration
  // change to DiffFile. Recreating CodeMirror for every graph update resets its native scroller to the top.
  const currentKey = current ? entryKey(current) : ''
  const registerCurrentView = useCallback((path, view) => registerView(currentKey, view), [registerView, currentKey])
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entryKey(entry) === selected))
  const toggleDir = useCallback((key) => setOpenDirs((open) => { const next = new Set(open); if (!next.delete(key)) next.add(key); return next }), [])
  const closeDraft = useCallback(() => setDraft(null), [])
  // Hunk stepping walks the READING LIST, so ↓ off the end of one file opens the next one instead of
  // stopping — but only the open file has a mounted view, so a step that leaves it selects and lands there.
  const navigateChunk = (direction) => {
    const command = direction > 0 ? goToNextChunk : goToPreviousChunk
    const view = views.current.get(selected)
    if (view && command(mode === 'split' ? view.b : view)) return
    if (entries.length < 2) return
    setSelected(entryKey(entries[(selectedIndex + direction + entries.length) % entries.length]))
  }
  const save = async () => { if (!draft || !body.trim()) return; const entry = entries.find((candidate) => candidate.file.path === draft.filePath) || current; if (!entry) return; const res = await apiFetch(sessionUrl(sessionId, 'diff-comments'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, filePath: draft.filePath || entry.file.path, body, diffIdentity: entry.file.diffIdentity }) }); if (res.ok) { setDraft(null); setBody(''); load() } }
  // Retracting the row a draft is currently editing would leave the composer pointed at something gone.
  const retract = async (comment) => {
    const res = await apiFetch(`${sessionUrl(sessionId, 'diff-comments')}/${encodeURIComponent(comment.id)}`, { method: 'DELETE' })
    if (!res.ok) return
    setDraft((current) => current?.id === comment.id ? null : current)
    load()
  }
  const send = async () => { const res = await apiFetch(sessionUrl(sessionId, 'diff-comments', 'send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (res.ok) load() }
  if (state.phase === 'loading') return <div className="diff-document diff-document-state"><div className="diff-state">{t('session.diffLoading')}</div></div>
  if (state.phase === 'unavailable') return <div className="diff-document diff-document-state"><div className="diff-state diff-unavailable">{t('session.diffUnavailable')}{state.detail ? <code className="diff-oids">{state.detail}</code> : null}</div></div>
  if (state.phase === 'error') return <div className="diff-document diff-document-state"><div className="diff-state error">{t('session.diffFailed', { message: state.error?.message || String(state.error) })}</div></div>
  // What the branch itself has to say, decided by the backend's branchState — never inferred from a list length.
  const branchNote = state.data.branchState === 'no-commits'
    ? <div className="diff-state diff-no-commits">{t('session.diffNoCommits')}</div>
    : state.data.branchState === 'merged'
      ? <div className="diff-state diff-merged"><strong>{t('session.diffMerged', { base: state.data.baseRef })}</strong>{state.data.commitUrl ? <a href={state.data.commitUrl} target="_blank" rel="noreferrer">{t('session.diffCommit', { commit: state.data.head })}</a> : <code>{state.data.head}</code>}</div>
      : <div className="diff-state">{t('session.diffEmpty')}</div>
  // The whole review's size, summed over every row the panel lists; each scope heading carries its own share.
  const total = diffTotals(entries.map((entry) => entry.file))
  // Each scope is headed in the sidebars' zone grammar — count pod, label, hairline ([[dock-modes]]) — and
  // its heading stays pinned while its own rows scroll under it.
  const scopeSection = (scope, list) => {
    if (!list.length) return null
    const sum = diffTotals(list)
    return <section key={scope} className="diff-scope">
      <div className={`si-zone diff-zone diff-zone-${scope}`} role="heading" aria-level="2">
        <span className="si-zone-count" aria-hidden="true">{sum.files}</span>
        <span className="si-zone-label">{t(scope === 'branch' ? 'session.diffGroupCommitted' : 'session.diffGroupUncommitted')}</span>
        <DiffStat additions={sum.additions} deletions={sum.deletions} />
      </div>
      <TreeRows nodes={buildDiffTree(list)} depth={0} prefix="" scope={scope} selected={selected}
        openDirs={openDirs} onToggleDir={toggleDir} onSelect={setSelected} />
    </section>
  }
  return <div className="diff-document" data-diff-document data-branch-state={state.data.branchState} lang={lang}>
    <header className="diff-toolbar">
      <span className="diff-refs"><Icon name="git-merge" size={14} /><strong>{state.data.branch}</strong><span>→</span><strong>{state.data.baseRef}</strong></span>
      {entries.length > 0 && <span className="diff-summary">{t('nodeView.filesChanged', { n: total.files })}<DiffStat additions={total.additions} deletions={total.deletions} /></span>}
      <span className="diff-toolbar-spacer" />
      <Segmented label={t('session.diffMode')} value={mode} onPick={setMode}
        options={[{ value: 'split', label: t('session.diffSplit') }, { value: 'unified', label: t('session.diffUnified') }]} />
      <SegmentedToggle pressed={wrap} onToggle={() => setWrap((value) => !value)}>{t('session.diffWrap')}</SegmentedToggle>
      {unsent > 0 && <span className="diff-unsent">{t('session.diffUnsent', { n: unsent })}</span>}
      <IconButton icon="send" size={14} className={unsent ? 'icon-btn primary' : 'icon-btn'} label={t('session.diffSend')} disabled={!unsent} onClick={send} />
    </header>
    {/* The object ids are the proof the header's names are only a label for; they stay complete and
        selectable, on their own quiet line rather than eating the control row's width. */}
    <code className="diff-oids">{state.data.head} → {state.data.base}</code>
    {!entries.length && branchNote}
    {entries.length > 0 && <div className="diff-review-body" style={{ '--diff-panel': `${panelWidth}px` }}>
      <nav className="diff-file-panel" aria-label={t('session.diffFiles')}>
        {[scopeSection('branch', committed), scopeSection('working', working)]}
      </nav>
      <div className="diff-panel-resize" onMouseDown={onPanelDrag} onDoubleClick={resetPanel} aria-hidden="true" />
      <div className="diff-files">
        {!committed.length && <div className="diff-scope-note">{branchNote}</div>}
        {current && <DiffFile key={`${entryKey(current)}:${current.file.diffIdentity}`} sessionId={sessionId} file={current.file} scope={current.scope}
          open mode={mode} wrap={wrap} comments={comments.filter((comment) => comment.filePath === current.file.path)}
          onView={registerCurrentView} onNext={() => navigateChunk(1)} onPrevious={() => navigateChunk(-1)}
          onComment={(start, end) => { if (start == null) return; setDraft({ filePath: current.file.path, lineStart: start, lineEnd: end }); setBody('') }}
          onEdit={(comment) => { setDraft(comment); setBody(comment.body) }} onRetract={retract} />}
      </div>
    </div>}
    {draft && <CommentComposer path={draft.filePath || current?.file.path || ''} draft={draft} body={body} onBody={setBody} onCancel={closeDraft} onSave={save} />}
  </div>
}
