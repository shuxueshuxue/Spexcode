import { useCallback, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { GLYPH } from './specMeta.js'
import { sessionDisplayState, sessionHandle, sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import SessionPicker from './SessionPicker.jsx'
import { useEscLayer } from './escStack.js'

// [[session-row]]: ONE session row, drawn the same on every surface that lists sessions — the dock's
// projection, the console, the phone. The module owns the row's face, its tree lead and fold control, and
// the zone header that groups a forest; it owns no surface of its own.

// the "locked / claimed by another session" indicator — the shared `lock` glyph ([[icon-system]]),
// monochrome currentColor, no color emoji. Shared by the session row and App's lock-hint banner.
export const LockGlyph = ({ size = 12 }) => <Icon name="lock" size={size} />

export function opSummary(ops) {
  if (!ops?.length) return null
  const by = {}
  ops.forEach((o) => { by[o.op] = (by[o.op] || 0) + 1 })
  return Object.entries(by).map(([op, n]) => `${GLYPH[op]}${n}`).join(' ')
}

// Reserve FoldPod's sibling slot here; a nested button would invalidate the row button.
export function RowLead({ guides = [], expandable, kin = 0 }) {
  const reservesFoldColumn = expandable || guides.length > 0
  return (
    <span className="sess-lead">
      {reservesFoldColumn && (
        <span className="sess-fold pod sess-fold-slot" aria-hidden="true">{kin}</span>
      )}
      {guides.map((cont, i) => {
        const kind = i === guides.length - 1 ? (cont ? 'tee' : 'elbow') : (cont ? 'rail' : 'gap')
        return <span key={i} className={`sess-rail ${kind}`} aria-hidden="true" />
      })}
    </span>
  )
}

// The subtree count is the ONLY parent disclosure. It is pointer-only ([[session-nesting]]), carries the
// expanded state itself, and suppresses mousedown focus without disturbing the current surface sink.
export function FoldPod({ expanded, rollup, kin, onToggle, inert = false }) {
  const label = `${expanded ? 'Hide' : 'Show'} ${kin} nested session${kin === 1 ? '' : 's'}`
  const style = expanded ? { color: rollup, borderColor: rollup } : { background: rollup, borderColor: rollup }
  if (inert) return <span aria-hidden="true" className={`sess-fold pod sess-fold-control${expanded ? ' open' : ''}`} style={style}>{kin}</span>
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`sess-fold pod sess-fold-control${expanded ? ' open' : ''}`}
      style={style}
      aria-expanded={expanded}
      aria-label={label}
      data-tip={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >{kin}</button>
  )
}

// The console's live row and inert drag projection share this complete tree. Only their outer semantics differ.
export function SessionConsoleTreeRow({ item, activeId, selecting = false, picked = new Set(), dragging = false, dropTarget = false, onToggleFold, rowProps = {}, inert = false, style }) {
  const { s } = item
  const selected = activeId === s.id
  const isPicked = selecting && picked.has(s.id)
  const lead = (item.expandable || item.depth)
    ? <RowLead guides={item.guides} expandable={item.expandable} kin={item.kin} />
    : null
  const fold = item.expandable ? { expanded: item.expanded, rollup: item.rollup, kin: item.kin } : null
  const treeClass = `sess-tree-row si-tree-row${dragging ? ' dragging' : ''}${dropTarget ? ' drop-target' : ''}${inert ? ' si-session-drag-ghost' : ''}`
  const itemClass = `si-item${selected && !selecting ? ' on' : ''}${isPicked ? ' picked' : ''}`
  const face = <>
    <SessionRow s={s} locked={false} showAvatar={false} lead={lead} />
  </>
  const treeStyle = { '--ov': labelColor(s.id), '--sess-fold-indent': `${item.depth * 14}px`, ...style }
  return (
    <div className={treeClass} data-session-depth={item.depth} style={treeStyle} {...(!inert ? { 'data-session-drop-id': s.id } : { 'aria-hidden': 'true' })}>
      <button type="button" className={itemClass} tabIndex={inert ? -1 : undefined} {...rowProps}>
        {selecting && !inert && <span className={`si-check${isPicked ? ' on' : ''}`} aria-hidden="true" />}
        {face}
      </button>
      {fold && <FoldPod {...fold} inert={inert} onToggle={onToggleFold} />}
    </div>
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
// colour-coded mark from sessionDisplayState (the effective status word stays on the hover title for a11y). The only
// per-surface flex is `showAvatar`: the map-side SessionWindow (beside the spec-node graph) KEEPS the
// avatar so a session cross-references its node avatars; the console sidebar and the phone drop it
// (redundant next to the headline). `lead` is the optional nesting fold gutter.
export function SessionRow({ s, locked, showAvatar = true, lead = null }) {
  const t = useT()
  const ops = opSummary(s.ops)
  const display = sessionDisplayState(s)
  // The row and the @ menu share one visible name. The stable handle remains available in the avatar
  // tooltip/search matching, but must not become a second row label.
  const headline = sessionHeadline(s)
  const statusWord = t(`status.${display.status}`)
  return (
    <>
      {lead}
      {showAvatar && <Avatar seed={s.id} status={display.status} title={`${sessionHandle(s)} · ${statusWord} — ${s.id.slice(0, 8)}`} />}
      {/* meta is rendered BEFORE the headline in source (CSS `order` keeps it visually last in the resting
          flex row) so that, when a selected row wraps ([[session-activity]] reveal), it can FLOAT onto the
          headline's first line and the wrapped lines below run full-width beneath it. */}
      <span className="sess-meta">
        <span className="sess-glyph" style={{ color: display.color }}
          data-tip={s.note ? `${statusWord} · ${s.note}` : statusWord}
          aria-label={s.note ? `${statusWord} · ${s.note}` : statusWord}>{display.glyph}</span>
        {ops && <span className="sess-ops">{ops}</span>}
      </span>
      <span className="sess-id" data-tip={headline}>{headline}</span>
      {s.archiveHazard && <span className="sess-hazard" data-tip={s.archiveHazard} aria-label={s.archiveHazard}><Icon name="issue-opened" size={13} /></span>}
      {locked && <span className="sess-lock" data-tip={t('sessionWindow.lockedTitle')}><LockGlyph /></span>}
    </>
  )
}

// Every list surface uses the same zone grammar. Offline and archive are foldable zones; their whole header is
// the disclosure control and the leading count pod is a visual marker inside it.
export function SessionZone({ item, baseClass, onToggle }) {
  const t = useT()
  const foldable = item.zone === 'offline' || item.zone === 'archive'
  const classes = `${baseClass} ${baseClass}-${item.zone}${foldable ? ` si-zone-fold${item.folded ? '' : ' open'}` : ''}${item.dropTarget ? ' drop-target' : ''}`
  if (!foldable) return <div className={classes}>{t(`sessionZone.${item.zone}`)}</div>
  const label = item.zone === 'archive'
    ? t(item.folded ? 'sessionZone.showArchive' : 'sessionZone.hideArchive', { n: item.count })
    : t(item.folded ? 'sessionZone.showHistory' : 'sessionZone.hideHistory', { n: item.count })
  return (
    <button type="button" className={classes} aria-expanded={!item.folded} aria-label={label} data-tip={label}
      data-archive-count={item.zone === 'archive' ? item.count : undefined}
      data-session-archive-drop={item.zone === 'archive' ? '' : undefined}
      data-session-archive-zone={item.zone === 'archive' ? '' : undefined} onClick={onToggle}>
      {(item.count > 0 || item.zone === 'archive') && <span className="si-zone-count" aria-hidden="true">{item.count}</span>}
      <span className="si-zone-label">{t(`sessionZone.${item.zone}`)}</span>
    </button>
  )
}

// A compact graph cross-reference: the badge is closed at rest, while the expanded picker is the same
// session choice language used by the graph menu and prose dispatch. Locking stays the graph gesture;
// opening a session remains an explicit double-click/navigation, so the badge never becomes a second dock.
export function SessionWindow({ sessions = [], activeId = null, onPick, onOpenSession, onNew }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  useEscLayer(open, () => setOpen(false))
  const active = sessions.find((session) => session.source === activeId)
  const faces = (active ? [active] : sessions).slice(0, 3)
  const choose = (id) => {
    if (id === 'new') { setOpen(false); onNew?.(); return }
    const session = sessions.find((item) => item.id === id)
    if (session) onPick?.(session)
  }
  const openSession = (id) => { setOpen(false); if (id !== 'new') onOpenSession?.(id) }
  return (
    <div className="sess-badge">
      <button type="button" className="sess-badge-trigger" aria-expanded={open} aria-controls="graph-session-picker"
        aria-label={t('sessionWindow.badgeLabel')} data-tip={t('sessionWindow.badgeLabel')} onClick={() => setOpen((value) => !value)}>
        <span className="sess-badge-face" aria-hidden="true">{faces.map((session) => <Avatar key={session.id} seed={session.id} status={session.status} size={15} />)}</span>
        <span className="sess-badge-count">{sessions.length}</span>
      </button>
      {open && (
        <div id="graph-session-picker" className="sess-badge-panel" role="dialog" aria-label={t('sessionWindow.badgeLabel')}>
          <SessionPicker sessions={sessions} value={active?.id || ''} onChange={choose} onOpen={openSession} includeNew filter={sessions.length > 5} compact ariaLabel={t('sessionWindow.badgeLabel')} />
        </div>
      )}
    </div>
  )
}

// The graph badge above is intentionally the only bounded cross-reference; the full forest remains owned by
// the dock, console and phone rows below.
