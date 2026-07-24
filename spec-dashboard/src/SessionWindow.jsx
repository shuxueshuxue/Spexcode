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

// @@@ RowLead ([[session-nesting]]) — the leading gutter on a nested session row: indentation rails plus a
// subtree-count badge for parents. The badge is deliberately passive: the whole row owns disclosure, so both
// desktop surfaces expose one click target with `aria-expanded` and never need a directional glyph.
export function RowLead({ guides = [], expandable, expanded, rollup, kin = 0 }) {
  return (
    <span className="sess-lead">
      {guides.map((cont, i) => {
        const kind = i === guides.length - 1 ? (cont ? 'tee' : 'elbow') : (cont ? 'rail' : 'gap')
        return <span key={i} className={`sess-rail ${kind}`} aria-hidden="true" />
      })}
      {expandable && (
        <span
          className={`sess-fold pod${expanded ? ' open' : ''}`}
          style={expanded ? { color: rollup, borderColor: rollup } : { background: rollup, borderColor: rollup }}
          data-tip={`${kin} nested session${kin === 1 ? '' : 's'}`}
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

// Both desktop list surfaces use the same zone grammar. Offline is the sole foldable zone; its count leads
// the label and the header itself is the only disclosure control.
export function SessionZone({ item, baseClass, onToggle }) {
  const t = useT()
  const classes = `${baseClass} ${baseClass}-${item.zone}${item.zone === 'offline' ? ` si-zone-fold${item.folded ? '' : ' open'}` : ''}`
  if (item.zone !== 'offline') return <div className={classes}>{t(`sessionZone.${item.zone}`)}</div>
  return (
    <button
      type="button" className={classes}
      aria-expanded={!item.folded}
      data-tip={t(item.folded ? 'sessionZone.showHistory' : 'sessionZone.hideHistory', { n: item.count })}
      onClick={onToggle}
    >
      {item.count > 0 && <span className="si-zone-count">{item.count}</span>}
      <span className="si-zone-label">{t(`sessionZone.${item.zone}`)}</span>
    </button>
  )
}

export default function SessionWindow({ sessions, activeId, onPick, onOpenSession }) {
  const t = useT()
  const { expanded, toggle } = useFold()
  // the offline zone rests folded here too ([[session-console]] — one disclosure per surface, collapsed on
  // every fresh mount); the graph-locked session stays a visible row even while the zone is folded.
  const [offlineOpen, setOfflineOpen] = useState(false)
  // memoized off the exposed fold Set (stable per state), matching the console list — the forest's
  // nest+zone-sort otherwise re-runs on every board poll AND every unrelated re-render of the glance.
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id), {
    zoneFolded: (z) => z === 'offline' && !offlineOpen,
    keepVisible: (s) => s.source === activeId,
  }), [sessions, expanded, offlineOpen, activeId])
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
          if (it.type === 'zone') {
            return <SessionZone key={`zone-${it.zone}`} item={it} baseClass="sesswin-zone" onToggle={() => setOfflineOpen((v) => !v)} />
          }
          const s = it.s
          // activeId is the locked session's worktree path (board highlight matches overlays by source),
          // so the row locks off s.source — NOT s.id (id keys the board tab; source keys the graph lock).
          const locked = s.source === activeId
          const lead = (it.expandable || it.depth)
            ? <RowLead guides={it.guides} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} />
            : null
          return (
            <button
              key={s.id}
              className={locked ? 'sess-row locked' : 'sess-row'}
              aria-expanded={it.expandable ? it.expanded : undefined}
              style={{ '--ov': labelColor(s.id) }}
              onClick={() => { onPick(s); if (it.expandable) toggle(s.id) }}
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
