import { useState } from 'react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './SpecNode.jsx'
import { sessionName, sessionHeadline, STATUS_COLOR, STATUS_GLYPH, sessionForest } from './session.js'
import { useT } from './i18n/index.jsx'

// @@@ RowLead ([[session-nesting]]) — the leading fold gutter on a nested session row: a `depth`-indent plus
// either a disclosure triangle (a parent) or an aligned placeholder (a leaf child). The triangle's COLOUR is
// the subtree rollup (STATUS_COLOR hues), a purely-informational hint; clicking it toggles fold WITHOUT
// selecting/opening the row (stopPropagation). Rendered only when nesting is in play (parent or depth>0), so a
// flat list with no children looks exactly as before.
export function RowLead({ depth, expandable, expanded, rollup, onToggle }) {
  return (
    <span className="sess-lead" style={{ paddingLeft: depth ? depth * 14 : 0 }}>
      {expandable ? (
        <span
          className="sess-fold" role="button" tabIndex={-1} style={{ color: rollup }}
          title={expanded ? 'Collapse children' : 'Expand children'}
          onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          onMouseDown={(e) => e.stopPropagation()}
        >{expanded ? '▾' : '▸'}</span>
      ) : (
        <span className="sess-fold placeholder" aria-hidden="true" />
      )}
    </span>
  )
}

// per-surface fold state: the `expanded` Set of parent ids (collapsed by default) + a toggle. Shared by both
// session-list surfaces so each keeps its own open/closed state. The Set is exposed (stable per state) so a
// caller can memoize the forest off it.
export function useFold() {
  const [expanded, setExpanded] = useState(() => new Set())
  const toggle = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  return { expanded, toggle }
}

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
// `showAvatar` gates the leading identity face: the map-side surfaces (SessionWindow beside the spec-node
// graph, the relationship-graph nodes) KEEP it so a session cross-references its node avatars; only the
// console's own terminal-styled sidebar hides it (redundant next to the headline). `compact` is the
// one-line face: the status collapses from the word to a single STATUS_GLYPH mark (word kept in the title).
export function SessionRow({ s, locked, handle, showAvatar = true, compact = false, lead = null }) {
  const t = useT()
  const ops = opSummary(s.ops)
  const headline = sessionHeadline(s)
  const statusWord = t(`status.${s.status}`)
  return (
    <>
      {lead}
      {showAvatar && <Avatar seed={s.id} status={s.status} title={`${sessionName(s)} · ${statusWord} — ${s.id.slice(0, 8)}`} />}
      <span className="sess-id" title={headline}>{headline}</span>
      {locked && <span className="sess-lock" title={t('sessionWindow.lockedTitle')}><LockGlyph /></span>}
      <span className="sess-meta">
        {compact
          ? <span className="sess-glyph" style={{ color: STATUS_COLOR[s.status] }} title={statusWord} aria-label={statusWord}>{STATUS_GLYPH[s.status]}</span>
          : <span className="sess-status" style={{ color: STATUS_COLOR[s.status] }}>{statusWord}</span>}
        {ops && <span className="sess-ops">{ops}</span>}
        {handle}
      </span>
    </>
  )
}

export default function SessionWindow({ sessions, activeId, onPick, onOpenSession }) {
  const t = useT()
  const { expanded, toggle } = useFold()
  const isExpanded = (id) => expanded.has(id)
  return (
    <div className="sesswin">
      {sessions.length === 0 ? (
        <div className="sesswin-empty">{t('sessionWindow.emptyBefore')}<kbd>⏎</kbd>{t('sessionWindow.emptyAfter')}</div>
      ) : (
        // same two-zone grouping + newest-first + compact one-line face as the console list ([[session-console]]);
        // the ONE difference is this map-side glance KEEPS the avatar (cross-references the node avatars). Nested
        // sessions fold under their spawner ([[session-nesting]]): the forest gives zone headers + rows, and a
        // parent's children appear only while expanded (collapsed by default).
        sessionForest(sessions, isExpanded).map((it) => {
          if (it.type === 'zone') return <div className={`sesswin-zone sesswin-zone-${it.zone}`} key={`zone-${it.zone}`}>{t(`sessionZone.${it.zone}`)}</div>
          const s = it.s
          // activeId is the locked session's worktree path (board highlight matches overlays by source),
          // so the row locks off s.source — NOT s.id (id keys the board tab; source keys the graph lock).
          const locked = s.source === activeId
          const lead = (it.expandable || it.depth)
            ? <RowLead depth={it.depth} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} onToggle={() => toggle(s.id)} />
            : null
          return (
            <button
              key={s.id}
              className={locked ? 'sess-row locked' : 'sess-row'}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => onPick(s)}
              onDoubleClick={() => onOpenSession(s.id)}
              title={t('sessionWindow.rowTitle')}
            >
              <SessionRow s={s} locked={locked} compact lead={lead} />
            </button>
          )
        })
      )}
    </div>
  )
}
