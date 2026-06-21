// @@@ SessionWindow - the always-on, top-right glance at live Claude Code sessions (one per
// worktree, plus queued prompts). Not a modal: it floats over the board so a human watching main
// sees, at a glance, who is working and what pending node changes each carries.
// @@@ two gestures, one mirrors the graph - single click LOCKS the graph onto this session (its
// overlays light up, every other node greys out); the locked row wears the same lock so the two
// surfaces read as one selection. Double-click opens that session's board (the mouse parallel to ⏎).
// The full interactive surface is the session interface; this stays the read-only summary.

import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './SpecNode.jsx'
import { STATUS_DOT, sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

// @@@ opSummary - a session's WHOLE pending change-set folded to a compact glyph tally ("+2 ~1 ✕1"): one
// entry per op kind with its count, i.e. how many nodes it is changing. The SINGLE place this is computed,
// reused by the top-right window AND the on-graph node peek (SpecNode/SessionPeek), so a session's count
// reads the same on both surfaces. null when it has no ops (nothing to summarise).
export function opSummary(ops) {
  if (!ops?.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

// @@@ SessionRow - one session as a single LOCKING row: avatar · status dot · name · (lock | status) · op
// tally. Single click locks the graph onto the session (onPick); a double-click opens its console where the
// host wires onOpenSession (the top-right window does; the on-graph peek leaves it unset — a node already
// owns double-click). Shared so a session reads identically wherever it is offered for locking — the window
// AND the node peek. stopPropagation keeps the click from also reaching the react-flow node behind the peek,
// so inside a node it locks the session WITHOUT also re-focusing that node.
export function SessionRow({ s, locked, onPick, onOpenSession }) {
  const t = useT()
  const ops = opSummary(s.ops)
  return (
    <button
      className={locked ? 'sess-row locked' : 'sess-row'}
      style={{ '--ov': labelColor(s.id) }}
      onClick={(e) => { e.stopPropagation(); onPick(s) }}
      onDoubleClick={onOpenSession ? (e) => { e.stopPropagation(); onOpenSession(s.id) } : undefined}
      title={t('sessionWindow.rowTitle')}
    >
      <Avatar seed={s.id} status={s.status} title={`${sessionName(s)} · ${t(`status.${s.status}`)} — ${s.id.slice(0, 8)}`} />
      <span className="sess-dot" style={{ background: STATUS_DOT[s.status] || '#93a1a1' }} />
      <span className="sess-id">{sessionName(s)}</span>
      {locked ? (
        <span className="sess-lock" title={t('sessionWindow.lockedTitle')}>🔒</span>
      ) : (
        <span className="sess-status">{t(`status.${s.status}`)}</span>
      )}
      {ops && <span className="sess-ops">{ops}</span>}
    </button>
  )
}

export default function SessionWindow({ sessions, activeId, onPick, onOpen, onOpenSession }) {
  const t = useT()
  return (
    <div className="sesswin">
      <div className="sesswin-head">
        <span className="sesswin-title">
          // {t('sessionWindow.title')}
          {sessions.length > 0 && <span className="sesswin-count">{sessions.length}</span>}
        </span>
        <button className="sesswin-new" onClick={onOpen} title={t('sessionWindow.newTitle')}>⏎ {t('common.new')}</button>
      </div>
      {sessions.length === 0 ? (
        <div className="sesswin-empty">{t('sessionWindow.emptyBefore')}<kbd>⏎</kbd>{t('sessionWindow.emptyAfter')}</div>
      ) : (
        // activeId is the locked session's worktree path (board highlight matches overlays by source),
        // so a row locks off s.source — NOT s.id (id keys the board tab; source keys the graph lock).
        sessions.map((s) => (
          <SessionRow key={s.id} s={s} locked={s.source === activeId} onPick={onPick} onOpenSession={onOpenSession} />
        ))
      )}
    </div>
  )
}
