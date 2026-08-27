import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { apiFetch, sessionUrl } from './data.js'
import { useI18n, useT } from './i18n/index.jsx'
import { Caret, Icon, IconButton } from './icons.jsx'
import { buildDiffTree, treeDirKeys, splitPath } from './diffTree.js'

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
const stillPresent = (data, key) => !!key && [
  ...(data?.files || []).map((file) => `branch:${file.path}`),
  ...(data?.working?.files || []).map((file) => `working:${file.path}`),
].includes(key)
const firstEntry = (data) => (data?.files || []).length ? { scope: 'branch', file: data.files[0] } : (data?.working?.files || []).length ? { scope: 'working', file: data.working.files[0] } : null

function DiffFile({ sessionId, file, scope, comments, open, mode, wrap, onComment, onEdit, onRetract, onView, onNext, onPrevious }) {
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
            extensions: [...readOnlyExtensions(parsed.newNumbers, lang, wrap), unifiedMergeView({
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

  // The header STAYS while the diff scrolls, because the one thing a reader loses inside a long hunk is
  // which file they are in. It spends its width on the leaf name and lets the directories in front of it
  // dim and give; the full path is on the tooltip, never abbreviated away.
  const { dirSegments, name } = splitPath(file.path)
  return <section className="diff-file is-open" data-diff-file={file.path} data-diff-scope={scope}>
    <header className="diff-file-head" data-tip={file.path}>
      <span className="diff-file-name"><PathHead segments={dirSegments} /><strong>{name}</strong></span>
      <span className={`diff-file-status is-${file.status}`}>{file.status}</span>
      <span className="diff-file-stat"><span className="diff-add">+{file.additions}</span> <span className="diff-del">−{file.deletions}</span></span>
      {scope === 'working' && <span className="diff-file-scope">{t('session.diffUncommitted')}</span>}
      <span className="diff-toolbar-spacer" />
      <span className="diff-hunk-tools"><button type="button" onClick={onPrevious} aria-label={t('session.diffPrevious')}>↑</button><button type="button" onClick={onNext} aria-label={t('session.diffNext')}>↓</button></span>
    </header>
    <div className={`diff-editor diff-editor-${mode}${wrap ? ' is-wrap' : ''}`} ref={host} onMouseDown={chooseLine} />
    {comments.length > 0 && <div className="diff-comments">{comments.map((comment) => <div key={comment.id} className={`diff-comment${comment.sentAt ? ' sent' : ''}`}>
      <span className="diff-comment-line">L{comment.lineStart}{comment.lineEnd !== comment.lineStart ? `-L${comment.lineEnd}` : ''}</span>
      <span className="diff-comment-body">{comment.body}</span>{comment.sentAt && <Icon name="check" size={12} />}<IconButton icon="pencil" size={12} label={t('session.diffEdit')} onClick={() => onEdit(comment)} />
      <IconButton icon="trash" size={12} label={t('session.diffRetract')} onClick={() => onRetract(comment)} />
    </div>)}</div>}
  </section>
}

// A path identifies itself by its TAIL, so when the room runs out the FRONT is what goes. CSS cannot do
// that honestly: `direction:rtl` moves the clip to the leading edge but reorders the neutral characters a
// path is full of (`.spec/…` renders as `/spec…`), and `unicode-bidi:plaintext` fixes the order by taking
// the run's own direction back — which puts the clip at the tail again. So the segments are laid out in a
// reversed flex row instead: DOM order reversed, visual order restored, and the overflow falls off the left
// with no bidi involved. Callers put the untruncated path on the row's tooltip.
// A hard clip with no marker reads as a typo (`ource-of-truth/…`), and `text-overflow` cannot reach across
// the separate segment boxes this layout needs — so the overflow is measured and the leading `…` is shown
// only when the path really is cut.
function PathHead({ segments }) {
  const box = useRef(null)
  const [clipped, setClipped] = useState(false)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => setClipped(element.scrollWidth > element.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [segments])
  if (!segments.length) return null
  return <span className={`path-head${clipped ? ' is-clipped' : ''}`} ref={box}>
    {[...segments].reverse().map((segment, index) => <span key={`${segments.length - index}:${segment}`}>{segment}/</span>)}
  </span>
}

// One row per directory and per changed file, indented on the shared `ft-` explorer vocabulary so the panel
// reads like the rest of this product's trees rather than a fourth way of drawing a hierarchy.
function TreeRows({ nodes, depth, prefix, scope, selected, openDirs, onToggleDir, onSelect }) {
  return nodes.map((node) => {
    if (node.kind === 'dir') {
      const key = prefix ? `${prefix}/${node.name}` : node.name
      const open = openDirs.has(key)
      return <Fragment key={`d:${key}`}>
        <button type="button" className="ft-row ft-dir" style={{ paddingLeft: 6 + depth * 11, '--depth': depth }}
          aria-expanded={open} data-tip={key} onClick={() => onToggleDir(key)}>
          <span className="ft-caret"><Caret open={open} /></span>
          <span className="ft-label">{node.name.includes('/')
            ? <><PathHead segments={node.name.split('/').slice(0, -1)} /><span className="path-leaf">{node.name.split('/').pop()}</span></>
            : <span className="path-leaf">{node.name}</span>}</span>
        </button>
        {open && <TreeRows nodes={node.children} depth={depth + 1} prefix={key} scope={scope}
          selected={selected} openDirs={openDirs} onToggleDir={onToggleDir} onSelect={onSelect} />}
      </Fragment>
    }
    const key = `${scope}:${node.file.path}`
    return <button type="button" key={`f:${key}`} className={`ft-row ft-code diff-tree-file${key === selected ? ' on' : ''}`}
      style={{ paddingLeft: 6 + depth * 11, '--depth': depth }} aria-current={key === selected ? 'true' : undefined}
      data-tip={node.file.path} onClick={() => onSelect(key)}>
      <span className="ft-caret" /><span className="ft-label"><span className="path-leaf">{node.name}</span></span>
      <span className="diff-tree-stat"><span className="diff-add">+{node.file.additions}</span> <span className="diff-del">−{node.file.deletions}</span></span>
    </button>
  })
}

export default function DiffDocument({ sessionId }) {
  const t = useT(); const { lang } = useI18n(); const views = useRef(new Map())
  const [state, setState] = useState({ phase: 'loading', data: null, error: null }); const [draft, setDraft] = useState(null); const [body, setBody] = useState('')
  const [mode, setMode] = useState('split'); const [wrap, setWrap] = useState(false); const [selected, setSelected] = useState('')
  const [openDirs, setOpenDirs] = useState(() => new Set())
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
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entryKey(entry) === selected))
  const toggleDir = useCallback((key) => setOpenDirs((open) => { const next = new Set(open); if (!next.delete(key)) next.add(key); return next }), [])
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
  if (state.phase === 'loading') return <div className="diff-state">{t('session.diffLoading')}</div>
  if (state.phase === 'unavailable') return <div className="diff-state diff-unavailable">{t('session.diffUnavailable')}{state.detail ? <code className="diff-oids">{state.detail}</code> : null}</div>
  if (state.phase === 'error') return <div className="diff-state error">{t('session.diffFailed', { message: state.error?.message || String(state.error) })}</div>
  // What the branch itself has to say, decided by the backend's branchState — never inferred from a list length.
  const branchNote = state.data.branchState === 'no-commits'
    ? <div className="diff-state diff-no-commits">{t('session.diffNoCommits')}</div>
    : state.data.branchState === 'merged'
      ? <div className="diff-state diff-merged"><strong>{t('session.diffMerged', { base: state.data.baseRef })}</strong>{state.data.commitUrl ? <a href={state.data.commitUrl} target="_blank" rel="noreferrer">{t('session.diffCommit', { commit: state.data.head })}</a> : <code>{state.data.head}</code>}</div>
      : <div className="diff-state">{t('session.diffEmpty')}</div>
  const scopeSection = (scope, list) => list.length > 0 && <Fragment key={scope}>
    <div className="diff-file-group">{t(scope === 'branch' ? 'session.diffGroupCommitted' : 'session.diffGroupUncommitted', { n: list.length })}</div>
    <TreeRows nodes={buildDiffTree(list)} depth={0} prefix="" scope={scope} selected={selected}
      openDirs={openDirs} onToggleDir={toggleDir} onSelect={setSelected} />
  </Fragment>
  return <div className="diff-document" data-diff-document data-branch-state={state.data.branchState} lang={lang}>
    <header className="diff-toolbar">
      <span className="diff-refs"><Icon name="git-merge" size={14} /><strong>{state.data.branch}</strong><span>→</span><strong>{state.data.baseRef}</strong></span>
      <span className="diff-toolbar-spacer" />
      <div className="diff-mode" role="group" aria-label={t('session.diffMode')}><button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>{t('session.diffSplit')}</button><button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>{t('session.diffUnified')}</button></div>
      <button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)}>{t('session.diffWrap')}</button>
      {unsent > 0 && <span className="diff-unsent">{t('session.diffUnsent', { n: unsent })}</span>}
      <IconButton icon="send" size={14} label={t('session.diffSend')} disabled={!unsent} onClick={send} />
    </header>
    {/* The object ids are the proof the header's names are only a label for; they stay complete and
        selectable, on their own quiet line rather than eating the control row's width. */}
    <code className="diff-oids">{state.data.head} → {state.data.base}</code>
    {!entries.length && branchNote}
    {entries.length > 0 && <div className="diff-review-body">
      <nav className="diff-file-panel" aria-label={t('session.diffFiles')}>
        <div className="diff-file-panel-head">
          <span>{t('session.diffFiles')}</span>
        </div>
        {[scopeSection('branch', committed), scopeSection('working', working)]}
      </nav>
      <div className="diff-files">
        {!committed.length && <div className="diff-scope-note">{branchNote}</div>}
        {current && <DiffFile key={`${entryKey(current)}:${current.file.diffIdentity}`} sessionId={sessionId} file={current.file} scope={current.scope}
          open mode={mode} wrap={wrap} comments={comments.filter((comment) => comment.filePath === current.file.path)}
          onView={(path, view) => registerView(entryKey(current), view)} onNext={() => navigateChunk(1)} onPrevious={() => navigateChunk(-1)}
          onComment={(start, end) => { if (start == null) return; setDraft({ filePath: current.file.path, lineStart: start, lineEnd: end }); setBody('') }}
          onEdit={(comment) => { setDraft(comment); setBody(comment.body) }} onRetract={retract} />}
      </div>
    </div>}
    {draft && <div className="diff-comment-compose" role="dialog"><strong>{t('session.diffComment')}</strong><span>{draft.filePath || current?.file.path}:L{draft.lineStart}</span><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('session.diffCommentPlaceholder')} /><div><button type="button" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button type="button" disabled={!body.trim()} onClick={save}>{t('session.diffCommentSave')}</button></div></div>}
  </div>
}
