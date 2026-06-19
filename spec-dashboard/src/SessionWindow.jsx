// @@@ SessionWindow - the always-on, top-right glance at live Claude Code sessions (one per
// worktree, plus queued prompts). Not a modal: it floats over the board so a human watching main
// sees, at a glance, who is working and what pending node changes each carries. Clicking a row
// highlights that session's overlays on the board (and focuses its first changed node). The full
// interactive surface is the session interface (Enter); this is the read-only summary.

import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'

const STATUS_DOT = { working: '#cb4b16', idle: '#93a1a1', offline: '#657b83', review: '#6c71c4', done: '#268bd2', 'close-pending': '#cb4b16', blocked: '#2aa198', error: '#dc322f', 'needs-input': '#b58900' }
const GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

function opSummary(ops) {
  if (!ops.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

export default function SessionWindow({ sessions, activeId, onPick, onOpen }) {
  return (
    <div className="sesswin">
      <div className="sesswin-head">
        <span className="sesswin-title">// sessions</span>
        <button className="sesswin-new" onClick={onOpen} title="open the session interface (⏎)">⏎ new</button>
      </div>
      {sessions.length === 0 ? (
        <div className="sesswin-empty">no live worktrees — press <kbd>⏎</kbd> to start one</div>
      ) : (
        sessions.map((s) => {
          const ops = opSummary(s.ops)
          return (
            <button
              key={s.id}
              className={s.id === activeId ? 'sess-row on' : 'sess-row'}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => onPick(s)}
            >
              <Avatar seed={s.id} status={s.status} title={`${s.node || s.title || s.branch || s.id} · ${s.status} — ${s.id.slice(0, 8)}`} />
              <span className="sess-dot" style={{ background: STATUS_DOT[s.status] || '#93a1a1' }} />
              <span className="sess-id">{s.node || s.title || s.branch || s.id}</span>
              <span className="sess-status">{s.status}</span>
              {ops && <span className="sess-ops">{ops}</span>}
            </button>
          )
        })
      )}
    </div>
  )
}
