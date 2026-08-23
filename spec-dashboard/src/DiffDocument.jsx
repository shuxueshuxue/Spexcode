import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { apiFetch, sessionUrl } from './data.js'
import { useI18n, useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'

const THEME = EditorView.theme({
  '&': { backgroundColor: 'var(--paper)', color: 'var(--ink)', fontSize: 'var(--type-meta)' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '8px 0' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none', opacity: '.7' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px' },
  '.cm-line': { whiteSpace: 'pre' },
})

function lineMap(patch) {
  let next = 0
  const map = []
  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { next = Number(hunk[1]); map.push(null); continue }
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ') || line.startsWith('index ')) { map.push(null); continue }
    if (line.startsWith('-')) { map.push({ oldLine: next }); continue }
    if (line.startsWith('+')) { map.push({ newLine: next }); next += 1; continue }
    if (line.startsWith('\\')) { map.push(null); continue }
    if (next) { map.push({ newLine: next }); next += 1 } else map.push(null)
  }
  return map
}

function DiffFile({ sessionId, file, comments, onComment, onEdit }) {
  const t = useT()
  const host = useRef(null)
  const view = useRef(null)
  const [open, setOpen] = useState(true)
  const [patch, setPatch] = useState(file.patch || '')
  const map = useMemo(() => lineMap(patch), [patch])
  useEffect(() => {
    if (!open || patch || !file.path) return undefined
    let live = true
    apiFetch(`${sessionUrl(sessionId, 'diff')}?path=${encodeURIComponent(file.path)}`, { cache: 'no-store' }).then((res) => res.json()).then((data) => {
      const loaded = data?.files?.[0]?.patch
      if (live && typeof loaded === 'string') setPatch(loaded)
    }).catch(() => {})
    return () => { live = false }
  }, [sessionId, file.path, open, patch])
  useEffect(() => {
    if (!host.current) return undefined
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: patch,
        extensions: [EditorState.readOnly.of(true), EditorView.editable.of(false), lineNumbers({ formatNumber: (n) => String(map[n - 1]?.newLine || map[n - 1]?.oldLine || n) }), THEME],
      }),
    })
    return () => { view.current?.destroy(); view.current = null }
  }, [patch, map, onComment])
  const chooseLine = (event) => {
    if (event.button !== 0) return
    const line = event.target.closest?.('.cm-line')
    if (!line || !host.current?.contains(line)) return
    const index = Array.from(host.current.querySelectorAll('.cm-line')).indexOf(line)
    const target = map[index]
    if (target) onComment(target.newLine || target.oldLine, target.newLine || target.oldLine)
  }
  return <section className="diff-file" data-diff-file={file.path}>
    <button type="button" className="diff-file-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}><strong>{file.path}</strong><span>{file.status}</span><span>+{file.additions} -{file.deletions}</span><span className="diff-toolbar-spacer" />{open ? '−' : '+'}</button>
    {open && <><div className="diff-editor" ref={host} onMouseDown={chooseLine} />
    {comments.map((comment) => <div key={comment.id} className={`diff-comment${comment.sentAt ? ' sent' : ''}`}>
      <span className="diff-comment-line">L{comment.lineStart}{comment.lineEnd !== comment.lineStart ? `-L${comment.lineEnd}` : ''}</span>
      <span>{comment.body}</span>{comment.sentAt && <Icon name="check" size={12} />}<IconButton icon="pencil" size={12} label={t('session.diffEdit')} onClick={() => onEdit(comment)} />
    </div>)}</>}
  </section>
}

export default function DiffDocument({ sessionId }) {
  const t = useT(); const { lang } = useI18n()
  const [state, setState] = useState({ phase: 'loading', data: null, error: null })
  const [draft, setDraft] = useState(null)
  const [body, setBody] = useState('')
  const load = () => {
    setState((current) => ({ ...current, phase: 'loading' }))
    apiFetch(sessionUrl(sessionId, 'diff'), { cache: 'no-store' }).then(async (res) => {
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      setState({ phase: 'ready', data, error: null })
    }).catch((error) => setState({ phase: 'error', data: null, error }))
  }
  useEffect(() => { load() }, [sessionId])
  const choose = (start, end) => { setDraft({ filePath: '', lineStart: start, lineEnd: end }); setBody('') }
  const save = async () => {
    if (!draft || !body.trim()) return
    const file = state.data?.files.find((candidate) => candidate.path === draft.filePath) || state.data?.files[0]
    if (!file) return
    const res = await apiFetch(sessionUrl(sessionId, 'diff-comments'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, filePath: draft.filePath || file.path, body, diffIdentity: file.diffIdentity }) })
    if (res.ok) { setDraft(null); setBody(''); load() }
  }
  const send = async () => {
    const res = await apiFetch(sessionUrl(sessionId, 'diff-comments', 'send'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (res.ok) load()
  }
  if (state.phase === 'loading') return <div className="diff-state">{t('session.diffLoading')}</div>
  if (state.phase === 'error') return <div className="diff-state error">{t('session.diffFailed', { message: state.error?.message || String(state.error) })}</div>
  const files = state.data?.files || []
  const comments = state.data?.comments || []
  const unsent = comments.filter((comment) => !comment.sentAt).length
  return <div className="diff-document" data-diff-document lang={lang}>
    <header className="diff-toolbar"><span className="diff-refs"><Icon name="git-merge" size={14} /><strong>{state.data.branch}</strong><span>→</span><strong>{state.data.baseRef}</strong></span><code className="diff-oids">{state.data.head} → {state.data.base}</code>
      <span className="diff-toolbar-spacer" />{unsent > 0 && <span>{t('session.diffUnsent', { n: unsent })}</span>}<IconButton icon="send" size={14} label={t('session.diffSend')} disabled={!unsent} onClick={send} />
    </header>
    {!files.length && (state.data.mergedIntoBase
      ? <div className="diff-state diff-merged"><strong>{t('session.diffMerged', { base: state.data.baseRef })}</strong>
        {state.data.commitUrl
          ? <a href={state.data.commitUrl} target="_blank" rel="noreferrer">{t('session.diffCommit', { commit: state.data.head })}</a>
          : <code>{state.data.head}</code>}
      </div>
      : <div className="diff-state">{t('session.diffEmpty')}</div>)}
    {files.map((file) => <DiffFile key={`${file.path}:${file.diffIdentity}`} sessionId={sessionId} file={file} comments={comments.filter((comment) => comment.filePath === file.path)} onComment={(start, end) => { setDraft({ filePath: file.path, lineStart: start, lineEnd: end }); setBody('') }} onEdit={(comment) => { setDraft(comment); setBody(comment.body) }} />)}
    {draft && <div className="diff-comment-compose" role="dialog"><strong>{t('session.diffComment')}</strong><span>{draft.filePath || files[0]?.path}:L{draft.lineStart}</span><textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} placeholder={t('session.diffCommentPlaceholder')} /><div><button type="button" onClick={() => setDraft(null)}>{t('common.cancel')}</button><button type="button" disabled={!body.trim()} onClick={save}>{t('session.diffCommentSave')}</button></div></div>}
  </div>
}
