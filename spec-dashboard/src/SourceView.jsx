import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { fetchSourceSlice } from './data.js'
import { useT } from './i18n/index.jsx'

// [[source-view]]: the read-only face of a governed source file. CodeMirror carries this rather than a list
// of rendered rows because it VIRTUALISES the viewport natively — measured, a 200k-line document renders in
// ~30ms with ~86 DOM nodes, where a span-per-token renderer needs seconds and six figures of nodes at a
// twentieth of the size. Nothing here can write: no editing surface exists on the board, and a spec-governed
// file changes through a session, never through a text box that races the agent holding the same file.

// The palette comes from the SAME CSS custom properties the rest of the board reads, so the viewer re-themes
// with the other seven themes instead of pinning one set of hexes (the mistake the node-status dots made).
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
  '&': { backgroundColor: 'var(--paper)', color: 'var(--ink)', fontSize: 'var(--type-meta)', height: '100%' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '6px 0' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.62', overflow: 'auto' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none', opacity: '.55' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 9px 0 12px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--line) 30%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink)', opacity: '1' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--blue) 28%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--blue)' },
}, { dark: true })

// A language pack is loaded ON DEMAND, per extension — it is a separate chunk, so opening a plain-text file
// never pays for a JavaScript parser. An unknown extension simply reads unhighlighted; that is a degraded
// reading, not a failure, so it must never block the bytes from appearing.
const JS_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'])
async function languageFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase()
  if (!JS_EXT.has(ext)) return []
  try {
    const { javascript } = await import('@codemirror/lang-javascript')
    return javascript({ jsx: ext.endsWith('sx'), typescript: ext.startsWith('t') || ext.startsWith('mt') || ext.startsWith('ct') })
  } catch {
    return []
  }
}

// how close to the bottom of the loaded text the reader must scroll before the next window is pulled.
const PREFETCH_PX = 900

export default function SourceView({ path, className = '', onSelection }) {
  const t = useT()
  const host = useRef(null)
  const view = useRef(null)
  const cursor = useRef({ offset: 0, eof: false, size: 0, busy: false })
  const [status, setStatus] = useState({ phase: 'loading', size: 0, loaded: 0, error: null })
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    let live = true
    cursor.current = { offset: 0, eof: false, size: 0, busy: false }
    setStatus({ phase: 'loading', size: 0, loaded: 0, error: null })
    setSelection(null)

    // Pull the next window and APPEND it. The append is a plain transaction at the document end, so the
    // reader's scroll position and selection survive it — paging must never yank the view.
    const pull = async () => {
      const c = cursor.current
      if (c.busy || c.eof) return
      c.busy = true
      try {
        const slice = await fetchSourceSlice(path, c.offset)
        if (!live) return
        c.offset += slice.bytes
        c.eof = slice.eof
        c.size = slice.size
        const v = view.current
        if (v && slice.text) v.dispatch({ changes: { from: v.state.doc.length, insert: slice.text } })
        setStatus({ phase: 'ready', size: slice.size, loaded: c.offset, error: null })
      } catch (e) {
        if (live) setStatus((s) => ({ ...s, phase: 'error', error: String(e?.message || e) }))
      } finally {
        c.busy = false
      }
    }

    const watchScroll = EditorView.updateListener.of((u) => {
      if (u.selectionSet) {
        const { from, to } = u.state.selection.main
        if (from === to) setSelection(null)
        else {
          const startLine = u.state.doc.lineAt(from).number
          const endLine = u.state.doc.lineAt(Math.max(from, to - 1)).number
          setSelection({ path, startLine, endLine, text: u.state.sliceDoc(from, to) })
        }
      }
      if (!u.geometryChanged && !u.docChanged) return
      const s = u.view.scrollDOM
      if (s.scrollHeight - s.scrollTop - s.clientHeight < PREFETCH_PX) pull()
    })

    const boot = async () => {
      const lang = await languageFor(path)
      if (!live || !host.current) return
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: '',
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            syntaxHighlighting(HIGHLIGHT),
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
            EditorView.lineWrapping,
            THEME,
            watchScroll,
            lang,
          ],
        }),
      })
      await pull()
    }
    boot()

    return () => {
      live = false
      view.current?.destroy()
      view.current = null
    }
  }, [path])

  const pct = status.size > 0 ? Math.min(100, Math.round((status.loaded / status.size) * 100)) : 0
  return (
    <div className={`srcview ${className}`.trim()}>
      <div className="srcview-body">
        <div className="srcview-cm" ref={host} />
        {selection && onSelection && (
          <button type="button" className="srcview-select-action" onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelection(selection)}>
            {t('sourceView.useSelection')}
          </button>
        )}
      </div>
      <div className="srcview-foot">
        <code className="srcview-path">{path}</code>
        {status.error
          ? <span className="srcview-err">{status.error}</span>
          : <span className="srcview-meter">
              {status.phase === 'loading' ? t('common.loading') : `${(status.size / 1024).toFixed(1)} KB`}
              {status.size > 0 && pct < 100 ? ` · ${pct}%` : ''}
            </span>}
      </div>
    </div>
  )
}
