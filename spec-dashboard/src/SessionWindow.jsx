import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './SpecNode.jsx'
import { sessionName, sessionHeadline, STATUS_COLOR } from './session.js'
import { useT } from './i18n/index.jsx'

// the "locked / claimed by another session" indicator — a monochrome inline-SVG padlock in the dashboard's
// own glyph vocabulary (currentColor, no color emoji). Shared by the session row and App's lock-hint banner.
export const LockGlyph = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" />
  </svg>
)

export function opSummary(ops) {
  if (!ops.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

// `handle` is an optional trailing node at the far right of row 2: the console passes the drag-reorder
// handle here ([[session-reorder]]), the read-only window passes nothing.
export function SessionRow({ s, locked, handle }) {
  const t = useT()
  const ops = opSummary(s.ops)
  const headline = sessionHeadline(s)
  return (
    <>
      <Avatar seed={s.id} status={s.status} title={`${sessionName(s)} · ${t(`status.${s.status}`)} — ${s.id.slice(0, 8)}`} />
      <span className="sess-id" title={headline}>{headline}</span>
      {locked && <span className="sess-lock" title={t('sessionWindow.lockedTitle')}><LockGlyph /></span>}
      <span className="sess-meta">
        <span className="sess-status" style={{ color: STATUS_COLOR[s.status] }}>{t(`status.${s.status}`)}</span>
        {ops && <span className="sess-ops">{ops}</span>}
        {handle}
      </span>
    </>
  )
}

export default function SessionWindow({ sessions, activeId, onPick, onOpenSession }) {
  const t = useT()
  return (
    <div className="sesswin">
      {sessions.length === 0 ? (
        <div className="sesswin-empty">{t('sessionWindow.emptyBefore')}<kbd>⏎</kbd>{t('sessionWindow.emptyAfter')}</div>
      ) : (
        sessions.map((s) => {
          // activeId is the locked session's worktree path (board highlight matches overlays by source),
          // so the row locks off s.source — NOT s.id (id keys the board tab; source keys the graph lock).
          const locked = s.source === activeId
          return (
            <button
              key={s.id}
              className={locked ? 'sess-row locked' : 'sess-row'}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => onPick(s)}
              onDoubleClick={() => onOpenSession(s.id)}
              title={t('sessionWindow.rowTitle')}
            >
              <SessionRow s={s} locked={locked} />
            </button>
          )
        })
      )}
    </div>
  )
}
