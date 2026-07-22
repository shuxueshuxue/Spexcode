import { useCallback, useMemo, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './specMeta.js'
import { sessionHandle, sessionHeadline, STATUS_COLOR, STATUS_GLYPH, sessionForest } from './session.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// the "locked / claimed by another session" indicator — the shared `lock` glyph ([[icon-system]]),
// monochrome currentColor, no color emoji. Shared by the session row and App's lock-hint banner.
export const LockGlyph = ({ size = 12 }) => <Icon name="lock" size={size} />

export function opSummary(ops) {
  if (!ops.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

// @@@ RowLead ([[session-nesting]]) — the leading gutter on a nested session row: file-tree connector RAILS
// (one thin-line column per `guides` entry, the last a `├`/`└` branch pointing at the row, earlier ones a
// pass-through `│` or a blank) that draw the child's belonging to its spawner, then — for a parent — the fold
// POD. The pod shows the SUBTREE COUNT (how much fleet hides here) on the subtree-rollup COLOUR (STATUS_COLOR
// hues, the same purely-informational hint the old triangle tinted): FILLED while collapsed (content hidden
// behind it), OUTLINE once expanded. Clicking toggles fold WITHOUT selecting/opening the row (stopPropagation)
// and WITHOUT stealing focus: mousedown is preventDefault'd so the pointerdown never shifts focus onto the pod
// or its focusable row-button ancestor — whichever surface currently owns input (TUI, Command Box, or New)
// keeps focus. A leaf child needs no pod — its branch rail is the affordance. Rendered only when
// nesting is in play (parent or depth>0), so a flat list with no children looks exactly as before.
export function RowLead({ guides = [], expandable, expanded, rollup, kin = 0, onToggle }) {
  return (
    <span className="sess-lead">
      {guides.map((cont, i) => {
        const kind = i === guides.length - 1 ? (cont ? 'tee' : 'elbow') : (cont ? 'rail' : 'gap')
        return <span key={i} className={`sess-rail ${kind}`} aria-hidden="true" />
      })}
      {expandable && (
        <span
          className={`sess-fold pod${expanded ? ' open' : ''}`} role="button"
          style={expanded ? { color: rollup, borderColor: rollup } : { background: rollup, borderColor: rollup }}
          data-tip={`${kin} nested session${kin === 1 ? '' : 's'} — click to ${expanded ? 'collapse' : 'expand'}`}
          onClick={(e) => { e.stopPropagation(); onToggle?.() }}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
        >{kin}</span>
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
  const expand = useCallback((ids) => setExpanded((prev) => {
    const missing = ids.filter((id) => id && !prev.has(id))
    if (!missing.length) return prev
    const next = new Set(prev)
    missing.forEach((id) => next.add(id))
    return next
  }), [])
  return { expanded, toggle, expand }
}

// THE session row face — ONE face for every list surface, desktop and mobile: the headline plus a single
// colour-coded STATUS_GLYPH mark (the exact status word stays on the hover title for a11y). The only
// per-surface flex is `showAvatar`: the map-side SessionWindow (beside the spec-node graph) KEEPS the
// avatar so a session cross-references its node avatars; the console sidebar and the phone drop it
// (redundant next to the headline). `lead` is the optional nesting fold gutter.
export function SessionRow({ s, locked, showAvatar = true, lead = null }) {
  const t = useT()
  const ops = opSummary(s.ops)
  const headline = sessionHeadline(s)
  const statusWord = t(`status.${s.status}`)
  return (
    <>
      {lead}
      {showAvatar && <Avatar seed={s.id} status={s.status} title={`${sessionHandle(s)} · ${statusWord} — ${s.id.slice(0, 8)}`} />}
      {/* meta is rendered BEFORE the headline in source (CSS `order` keeps it visually last in the resting
          flex row) so that, when a selected row wraps ([[session-activity]] reveal), it can FLOAT onto the
          headline's first line and the wrapped lines below run full-width beneath it. */}
      <span className="sess-meta">
        <span className="sess-glyph" style={{ color: STATUS_COLOR[s.status] }} data-tip={statusWord} aria-label={statusWord}>{STATUS_GLYPH[s.status]}</span>
        {ops && <span className="sess-ops">{ops}</span>}
      </span>
      <span className="sess-id" data-tip={headline}>{headline}</span>
      {locked && <span className="sess-lock" data-tip={t('sessionWindow.lockedTitle')}><LockGlyph /></span>}
    </>
  )
}

export default function SessionWindow({ sessions, activeId, onPick, onOpenSession }) {
  const t = useT()
  const { expanded, toggle } = useFold()
  // memoized off the exposed fold Set (stable per state), matching the console list — the forest's
  // nest+zone-sort otherwise re-runs on every board poll AND every unrelated re-render of the glance.
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id)), [sessions, expanded])
  return (
    <div className="sesswin">
      {sessions.length === 0 ? (
        <div className="sesswin-empty">{t('sessionWindow.emptyBefore')}<kbd>⏎</kbd>{t('sessionWindow.emptyAfter')}</div>
      ) : (
        // same two-zone grouping + newest-first + compact one-line face as the console list ([[session-console]]);
        // the ONE difference is this map-side glance KEEPS the avatar (cross-references the node avatars). Nested
        // sessions fold under their spawner ([[session-nesting]]): the forest gives zone headers + rows, and a
        // parent's children appear only while expanded (collapsed by default).
        forest.map((it) => {
          if (it.type === 'zone') return <div className={`sesswin-zone sesswin-zone-${it.zone}`} key={`zone-${it.zone}`}>{t(`sessionZone.${it.zone}`)}</div>
          const s = it.s
          // activeId is the locked session's worktree path (board highlight matches overlays by source),
          // so the row locks off s.source — NOT s.id (id keys the board tab; source keys the graph lock).
          const locked = s.source === activeId
          const lead = (it.expandable || it.depth)
            ? <RowLead guides={it.guides} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} onToggle={() => toggle(s.id)} />
            : null
          return (
            <button
              key={s.id}
              className={locked ? 'sess-row locked' : 'sess-row'}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => onPick(s)}
              onDoubleClick={() => onOpenSession(s.id)}
              data-tip={t('sessionWindow.rowTitle')}
            >
              <SessionRow s={s} locked={locked} lead={lead} />
            </button>
          )
        })
      )}
    </div>
  )
}
