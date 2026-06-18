import { useEffect, useState } from 'react'
import TermPane from './TermPane.jsx'

// @@@ pane registry - add a face for a spec node by adding one entry + one render case below.
export const PANES = [
  { key: 'work',    label: 'work' },
  { key: 'recent',  label: 'recent' },
  { key: 'history', label: 'history' },
]

// @@@ inline - the only inline markdown the spec bodies actually use: `code` (78×), **bold**,
// and [[links]]. Anything else passes through as text. Keeps us off a full markdown dependency.
function inline(text) {
  const out = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[\[([^\]]+)\]\]/g
  let last = 0, m, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<code key={k++}>{m[1]}</code>)
    else if (m[2] != null) out.push(<strong key={k++}>{m[2]}</strong>)
    else out.push(<span className="doc-link" key={k++}>{m[3]}</span>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// @@@ SpecBody - render the spec.md body as a current-state document (markdown). It is NOT a
// changelog — version history is the recent/history tabs, sourced from git (spex lint's `living`
// rule keeps `## vN` headings out of the body). Fence-aware tokenizer: ``` code, # headings,
// `- ` lists, paragraphs. The leading `# title` line is dropped (it duplicates the panel header).
function SpecBody({ body }) {
  if (!body) return null
  const lines = body.replace(/^#\s+[^\n]*\n+/, '').split('\n')
  const out = []
  let i = 0, k = 0, inFence = false
  while (i < lines.length) {
    const t = lines[i].trim()
    if (/^```/.test(t)) {
      const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
      i++ // closing fence
      out.push(<pre className="doc-pre" key={k++}><code>{buf.join('\n')}</code></pre>)
    } else if (/^#{1,6}\s+/.test(lines[i])) {
      out.push(<h4 className="doc-h" key={k++}>{inline(lines[i].replace(/^#+\s+/, ''))}</h4>); i++
    } else if (/^-\s+/.test(t)) {
      const items = []
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) items.push(lines[i++].trim().replace(/^-\s+/, ''))
      out.push(<ul key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>)
    } else if (t === '') {
      i++
    } else {
      const buf = []
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === '' || /^```/.test(l.trim()) || /^#{1,6}\s+/.test(l) || /^-\s+/.test(l.trim())) break
        buf.push(l); i++
      }
      out.push(<p key={k++}>{inline(buf.join(' '))}</p>)
    }
  }
  return <div className="doc-body">{out}</div>
}

function SpecPane({ node }) {
  return (
    <div className="pane-doc">
      <h1># {node.title}</h1>
      <blockquote>{node.desc}</blockquote>
      <div className="doc-meta">
        status: <b>{node.status}</b> · version: <b>v{node.version || 0}</b> · session: <b>{node.session || 'idle'}</b>
      </div>
      {node.code?.length > 0 && (
        <div className="doc-code">
          <span className="doc-code-h">// governs</span>
          {node.code.map((f) => <code key={f} className="doc-code-f">{f}</code>)}
        </div>
      )}
      <SpecBody body={node.body} />
    </div>
  )
}

// @@@ WorkPane - spec + terminal as one surface: intent on the left (read), the live
// session on the right (act). Terminal is wider — it's the work surface; spec is reference.
// onNav lets the terminal's external command line walk the tree when the line is empty.
function WorkPane({ node, onNav }) {
  return (
    <div className="pane-work">
      <SpecPane node={node} />
      <TermPane node={node} onNav={onNav} />
    </div>
  )
}

// @@@ useHistory - the node's version log from git (/api/specs/:id/history), newest first. Both
// panes below read it: `recent` shows only row 0 (the current version), `history` shows them all.
function useHistory(id) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    fetch(`/api/specs/${id}/history`).then((r) => r.json()).then((d) => { if (on) setRows(d) }).catch(() => on && setRows([]))
    return () => { on = false }
  }, [id])
  return rows
}

// one version row (number · hash · date · the +adds/-dels it changed in THIS node · reason · session).
function VersionRow({ r, v, latest }) {
  return (
    <div className={latest ? 'ver-row latest' : 'ver-row'}>
      <div className="rec-head">
        <span className="rec-v">v{v}</span>
        <code className="rec-hash">{r.hash.slice(0, 7)}</code>
        <span className="rec-date">{(r.date || '').slice(0, 10)}</span>
        <span className="rec-diff">
          <b className="rec-add">+{r.additions ?? 0}</b>
          <b className="rec-del">−{r.deletions ?? 0}</b>
        </span>
      </div>
      <div className="rec-msg">{r.reason}</div>
      <div className="rec-sub">{r.files ?? 0} file{r.files === 1 ? '' : 's'} changed · {r.session || 'idle'}</div>
    </div>
  )
}

// @@@ RecentPane - the CURRENT version only: its changelog + line-diff, plus the A→B proof evidence
// (placeholder SVG shots now; the yatsu package will record the real before/after later). The full
// version log lives in the `history` tab — this answers "what was the latest change, and the proof".
function RecentPane({ node }) {
  const rows = useHistory(node.id)
  const latest = rows?.[0]
  return (
    <div className="pane-recent">
      {!rows ? <div className="rec-msg muted">loading…</div>
        : latest ? <VersionRow r={latest} v={rows.length} latest />
        : <div className="rec-msg muted">no versions yet — open the work pane to begin.</div>}
      <figure className="rec-evidence">
        {node.evidence?.length ? (
          <div className="ev-pair">
            {node.evidence.map((src, i) => (
              <div className="ev-shot" key={i}><img src={src} alt={`evidence ${i + 1}`} /></div>
            ))}
          </div>
        ) : (
          <figcaption className="ev-note">no proof evidence yet — the yatsu package (pending) will record the A→B here</figcaption>
        )}
      </figure>
    </div>
  )
}

// @@@ HistoryPane - the full version log, newest first. (RecentPane shows only the top of this list.)
function HistoryPane({ node }) {
  const rows = useHistory(node.id)
  if (!rows) return <div className="pane-hist empty">loading history…</div>
  if (!rows.length) return <div className="pane-hist empty">no versions yet — open the work pane to begin.</div>
  return (
    <div className="pane-hist">
      {rows.map((r, i) => <VersionRow key={r.hash} r={r} v={rows.length - i} latest={i === 0} />)}
    </div>
  )
}

export default function NodeView({ node, pane, setPane, onClose, onNav }) {
  return (
    <div className="ov-backdrop" onMouseDown={onClose}>
      <div className="ov-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <span className="ov-title">{node.title}</span>
          <div className="ov-tabs">
            {PANES.map((p, i) => (
              <button key={p.key} className={p.key === pane ? 'ov-tab on' : 'ov-tab'} onClick={() => setPane(p.key)}>
                <kbd>{i + 1}</kbd> {p.label}
              </button>
            ))}
          </div>
          <span className="ov-hint">tab ↹ switch · esc back</span>
        </div>
        <div className="ov-body">
          {pane === 'work' && <WorkPane node={node} onNav={onNav} />}
          {pane === 'recent' && <RecentPane node={node} />}
          {pane === 'history' && <HistoryPane node={node} />}
        </div>
      </div>
    </div>
  )
}
