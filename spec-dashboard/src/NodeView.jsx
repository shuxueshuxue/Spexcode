import { useEffect, useState } from 'react'

// @@@ pane registry - add a face for a spec node by adding one entry + one render case below.
// The node popup is now PURELY a reference view (spec doc + version timeline); the live terminal
// moved out to the session interface (Enter), so there's no `work` pane and no keyboard special-case.
export const PANES = [
  { key: 'spec',    label: 'spec' },
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

// @@@ TwoPart - render the body as the two labelled parts the backend parses (node.parts):
//   raw source (human, needs approval) · expanded spec (agent, must match raw). Each part is a card
//   with an owner badge so the reader sees WHO owns it and how stable it is. There is deliberately NO
//   agent-authored "current state" card — what's-done is DERIVED (the status/version/drift in the meta
//   line), never narrated, because agents hallucinate completion. Legacy bodies (parts === null) fall
//   back to the whole-body SpecBody in SpecPane.
function PartCard({ kind, title, owner, note, children }) {
  return (
    <section className={`spec-part part-${kind}`}>
      <header className="part-head">
        <span className="part-title">{title}</span>
        <span className={`part-owner owner-${owner}`}>{owner}</span>
        {note && <span className="part-note">{note}</span>}
      </header>
      <div className="part-body">{children}</div>
    </section>
  )
}
function TwoPart({ parts }) {
  return (
    <div className="spec-parts">
      <PartCard kind="raw" title="raw source" owner="human" note="rarely changed · needs approval">
        <SpecBody body={parts.rawSource} />
      </PartCard>
      <PartCard kind="expanded" title="expanded spec" owner="agent" note="versioned often · must match raw source">
        <SpecBody body={parts.expandedSpec} />
      </PartCard>
    </div>
  )
}

function SpecPane({ node }) {
  return (
    <div className="pane-doc">
      <h1># {node.title}</h1>
      <blockquote>{node.desc}</blockquote>
      <div className="doc-meta">
        status: <b>{node.status}</b> · version: <b>v{node.version || 0}</b> · last edited by: <b>{node.session || 'none'}</b>
      </div>
      {node.code?.length > 0 && (
        <div className="doc-code">
          <span className="doc-code-h">// governs</span>
          {node.code.map((f) => <code key={f} className="doc-code-f">{f}</code>)}
        </div>
      )}
      {node.parts ? <TwoPart parts={node.parts} /> : <SpecBody body={node.body} />}
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
// `rows` is fetched ONCE by NodeView and shared with HistoryPane, so switching recent↔history doesn't refetch.
function RecentPane({ node, rows }) {
  const latest = rows?.[0]
  return (
    <div className="pane-recent">
      {!rows ? <div className="rec-msg muted">loading…</div>
        : latest ? <VersionRow r={latest} v={rows.length} latest />
        : <div className="rec-msg muted">no versions yet — this spec is the latest ground truth.</div>}
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
// `rows` comes from NodeView's single fetch — shared with RecentPane so tab-switching is instant.
function HistoryPane({ rows }) {
  if (!rows) return <div className="pane-hist empty">loading history…</div>
  if (!rows.length) return <div className="pane-hist empty">no versions yet — this spec is the latest ground truth.</div>
  return (
    <div className="pane-hist">
      {rows.map((r, i) => <VersionRow key={r.hash} r={r} v={rows.length - i} latest={i === 0} />)}
    </div>
  )
}

export default function NodeView({ node, pane, setPane, onClose }) {
  // one fetch per node, shared by both recent + history panes (the popup's only data dependency).
  const rows = useHistory(node.id)
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
          <span className="ov-hint">←→/hl/tab switch · j/k scroll · ⏎ session · esc back</span>
        </div>
        <div className="ov-body">
          {pane === 'spec' && <div className="pane-solo"><SpecPane node={node} /></div>}
          {pane === 'recent' && <RecentPane node={node} rows={rows} />}
          {pane === 'history' && <HistoryPane rows={rows} />}
        </div>
      </div>
    </div>
  )
}
