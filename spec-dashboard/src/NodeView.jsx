import { useEffect, useState } from 'react'
import TermPane from './TermPane.jsx'

// @@@ pane registry - add a face for a spec node by adding one entry + one render case below.
export const PANES = [
  { key: 'work',     label: 'work' },
  { key: 'evidence', label: 'evidence' },
  { key: 'history',  label: 'history' },
]

function SpecPane({ node }) {
  return (
    <div className="pane-doc">
      <h1># {node.title}</h1>
      <blockquote>{node.desc}</blockquote>
      <div className="doc-meta">
        status: <b>{node.status}</b> · version: <b>v{node.version || 0}</b> · session: <b>{node.session || 'idle'}</b>
      </div>
      <p className="doc-note">// spec = the intent (left). drive the session to change it in place (right).</p>
    </div>
  )
}

// @@@ WorkPane - spec + terminal as one surface: intent on the left (read), the live
// session on the right (act). Terminal is wider — it's the work surface; spec is reference.
function WorkPane({ node, onClose }) {
  return (
    <div className="pane-work">
      <SpecPane node={node} />
      <TermPane node={node} onClose={onClose} />
    </div>
  )
}

function EvidencePane({ node }) {
  return (
    <div className="pane-ev">
      <figure>
        <img src={node.shots.before} alt="before" />
        <figcaption>A · before (v{Math.max((node.version || 0) - 1, 0)})</figcaption>
      </figure>
      <div className="ev-arrow">→</div>
      <figure>
        <img src={node.shots.after} alt="after" />
        <figcaption>B · {node.version ? `after (v${node.version})` : 'pending'}</figcaption>
      </figure>
    </div>
  )
}

// @@@ HistoryPane - real version history from git (spec-cli /api/specs/:id/history).
// Each row: version, the session it was attributed to, and the commit subject (the reason).
function HistoryPane({ node }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let on = true
    fetch(`/api/specs/${node.id}/history`).then((r) => r.json()).then((d) => { if (on) setRows(d) }).catch(() => on && setRows([]))
    return () => { on = false }
  }, [node.id])

  if (!rows) return <div className="pane-hist empty">loading history…</div>
  if (!rows.length) return <div className="pane-hist empty">no versions yet — open the work pane to begin.</div>
  return (
    <div className="pane-hist">
      {rows.map((r, i) => (
        <div className="hist-row" key={r.hash}>
          <span className="hist-v">v{rows.length - i}</span>
          <span className="hist-sess">{r.session || '—'}</span>
          <span className="hist-msg">{r.reason}</span>
        </div>
      ))}
    </div>
  )
}

export default function NodeView({ node, pane, setPane, onClose }) {
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
          {pane === 'work' && <WorkPane node={node} onClose={onClose} />}
          {pane === 'evidence' && <EvidencePane node={node} />}
          {pane === 'history' && <HistoryPane node={node} />}
        </div>
      </div>
    </div>
  )
}
