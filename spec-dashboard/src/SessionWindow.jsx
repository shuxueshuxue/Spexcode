// @@@ SessionWindow - the always-on, top-left glance at live Claude Code sessions (one per
// worktree, plus queued prompts). Not a modal: it floats over the board so a human watching main
// sees, at a glance, who is working and what pending node changes each carries.
// @@@ two gestures, one mirrors the graph - single click LOCKS the graph onto this session (its
// overlays light up, every other node greys out); the locked row wears the same lock so the two
// surfaces read as one selection. Double-click opens that session's board (the mouse parallel to ⏎).
// The full interactive surface is the session interface; this stays the read-only summary.

import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './SpecNode.jsx'
import { sessionName, sessionHeadline, STATUS_COLOR } from './session.js'
import { useT } from './i18n/index.jsx'

// @@@ opSummary - a session's overlay tally: how many nodes it is changing, by op ("+2 ~1 ✕1"). Exported
// so the session-board tabs (SessionInterface) render the SAME count from the SAME logic as these rows.
export function opSummary(ops) {
  if (!ops.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

// @@@ SessionRow - the shared session FACE: a TWO-row block. Row 1 is the HEADLINE — avatar · what the
// session is about (sessionHeadline: the live tmux self-summary once it exists, else a placeholder of the
// launch prompt's first words) · 🔒 when this row owns the graph. The headline gets the whole line so the
// agent's smart, ever-changing task description has room to read — the avatar (seeded by id) is the fixed
// anchor, not the text. Row 2 is the STATUS line: the colour-coded status word · op tally (how many spec
// nodes this session is changing) — the small badges that used to crowd the title, now on their own line
// with room to grow. The top-left window AND the session-board tab both render THIS, so a session reads
// identically on either surface. Each surface wraps it in its own button with its own handlers and
// active/locked styling; the classes are global, so the face styles the same in either.
export function SessionRow({ s, locked }) {
  const t = useT()
  const ops = opSummary(s.ops)
  const headline = sessionHeadline(s)
  return (
    <>
      <Avatar seed={s.id} status={s.status} title={`${sessionName(s)} · ${t(`status.${s.status}`)} — ${s.id.slice(0, 8)}`} />
      <span className="sess-id" title={headline}>{headline}</span>
      {locked && <span className="sess-lock" title={t('sessionWindow.lockedTitle')}>🔒</span>}
      <span className="sess-meta">
        <span className="sess-status" style={{ color: STATUS_COLOR[s.status] }}>{t(`status.${s.status}`)}</span>
        {ops && <span className="sess-ops">{ops}</span>}
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
