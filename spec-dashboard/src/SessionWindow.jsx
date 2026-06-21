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

function opSummary(ops) {
  if (!ops.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
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
        sessions.map((s) => {
          const ops = opSummary(s.ops)
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
        })
      )}
    </div>
  )
}
