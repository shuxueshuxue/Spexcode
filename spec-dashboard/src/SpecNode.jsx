import { Handle, Position } from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { SessionRow } from './SessionWindow.jsx'
import { useT } from './i18n/index.jsx'

// @@@ timeAgo - compact "edited Nm/Nh/Nd ago" from an ISO date. Coarse on purpose (the row is tiny):
// seconds→"just now", then minutes, hours, days, weeks. Returns null for a missing/unparseable date so
// the caller can fall back to "no versions yet". The localized words come from the caller's `t`.
function timeAgo(iso, t) {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 45) return t('time.justNow')
  const m = s / 60, h = m / 60, d = h / 24
  if (m < 45) return t('time.minutes', { n: Math.round(m) })
  if (h < 22) return t('time.hours', { n: Math.round(h) })
  if (d < 7) return t('time.days', { n: Math.round(d) })
  return t('time.weeks', { n: Math.round(d / 7) })
}

const MAX_AVATARS = 4   // beyond this the row shows "+N" rather than overflow the node width

// the four backend-DERIVED states (specs.ts deriveStatus): merged in-sync, active in-flight,
// drift = governed code ahead of spec, pending = no committed version. The dot takes the colour.
// Exported so the Legend (Legend.jsx) reads the SAME source as the nodes — it can never drift.
export const STATUS = {
  merged:  { color: '#859900' },
  active:  { color: '#cb4b16' },
  drift:   { color: '#b58900' },
  pending: { color: '#93a1a1' },
}

// the pending-op glyphs an overlay can stamp on a node. Exported alongside STATUS for the Legend.
export const GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

// @@@ EditorRow - the node's SECOND row. When live session(s) are editing this node (App decorates
// `data.editors` from the live overlay), it shows their avatars — deterministic faces generated from
// each session id (see avatar.jsx; later swappable for real assets via the provider registry). With no
// live editor it falls back to "last edited … ago" (from `data.lastEdited`), or "no versions yet" for a
// node with no committed history. So the row always says SOMETHING about the node's people/recency.
function EditorRow({ data }) {
  const t = useT()
  const editors = data.editors || []
  if (editors.length > 0) {
    const shown = editors.slice(0, MAX_AVATARS)
    const extra = editors.length - shown.length
    return (
      <span className="node-editors" title={t('specNode.liveEditors', { n: editors.length })}>
        {shown.map((e) => (
          <Avatar key={e.id} seed={e.id} status={e.status}
            title={t('specNode.editorTitle', { node: e.node || t('common.session'), status: t(`status.${e.status}`), id: e.id.slice(0, 8) })} />
        ))}
        {extra > 0 && <span className="av-more" title={t('specNode.more', { n: extra })}>+{extra}</span>}
      </span>
    )
  }
  const ago = timeAgo(data.lastEdited, t)
  return (
    <span className="node-lastedit">
      {ago ? <>{t('specNode.lastEdited')} <b>{ago}</b></> : t('specNode.noVersions')}
    </span>
  )
}

// @@@ IssueBadge - the at-a-glance count of OPEN issues the forge linked to this node (spec-forge, folded
// into /api/board as data.openIssues). Rendered ONLY when there are any. Magenta, a hue distinct from the
// status dot AND the drift-badge so the three signals never blur: status dot = derived state, drift-badge
// = code ahead of spec, this = work pointing AT the node. This is purely the glance; the DETAIL lives in
// IssuePopover, which is now revealed by the WHOLE node (hover/focus), not by this marker alone.
function IssueBadge({ issues, t }) {
  if (!issues || issues.length === 0) return null
  return <span className="issue-badge" title={t('specNode.openIssues', { n: issues.length })}>◆{issues.length}</span>
}

// @@@ IssuePopover - the bound-WORK detail CARD. It is a direct child of `.spec-node` (not nested in the
// badge), so CSS reveals it on the ENTIRE node's hover OR focus (selected = clicked or keyboard-navigated
// to), never just the tiny badge. It reads as a card — slightly wider than a node, a header plus one
// two-line mini-card per issue: number + state on top, the FULL title wrapping below (not one ellipsized
// line). Each card links to the forge; stopPropagation keeps a click off the node's session-open. nodrag/
// nopan stop react-flow stealing the pointer so the links stay clickable. The single detail surface — no
// second pane, no extra route. Rendered only when there are issues, so it never reveals an empty card.
function IssuePopover({ issues, t }) {
  if (!issues || issues.length === 0) return null
  return (
    <div className="issue-popover nodrag nopan" role="tooltip">
      <div className="issue-pop-head">◆ {t('specNode.openIssuesCount', { n: issues.length })}</div>
      {issues.map((i) => (
        <a key={i.number} className="issue-card" href={i.url} target="_blank" rel="noreferrer"
          onClick={(e) => e.stopPropagation()}>
          <span className="issue-card-top">
            <span className="issue-num">#{i.number}</span>
            <span className={`issue-state st-${(i.state || '').toLowerCase()}`}>{i.state}</span>
          </span>
          <span className="issue-card-title">{i.title}</span>
        </a>
      ))}
    </div>
  )
}

// @@@ SessionPeek - the on-graph REVIEW window for a node carrying pending changes. A node mid-change is
// near-empty on the board — most of all a freshly-ADDED ghost (no title/version committed yet) — so the
// overlay alone is useless to review. This surfaces it through the SESSION lens: a small card that mirrors
// IssuePopover (a direct child of .spec-node, CSS-revealed on the WHOLE node's hover OR focus) but drops
// BELOW the node so it never collides with the issue card above. It lists the live session(s) changing this
// node, each as the SAME SessionRow the top-right window uses — including its op tally ("+2 ~1 ✕1" = how
// many nodes that session is changing). Clicking a row hands straight to the existing review flow
// (onPick → App.onPickSession: lock the graph onto the session, grey the rest, auto-focus its first changed
// node). Rendered only when sessions edit the node, so it never reveals an empty card. nodrag/nopan stop
// react-flow stealing the pointer so the rows stay clickable.
function SessionPeek({ sessions, onPick, lockedSource, t }) {
  if (!sessions || sessions.length === 0 || !onPick) return null
  return (
    <div className="session-peek nodrag nopan" role="tooltip">
      <div className="session-peek-head">// {t('sessionWindow.peekHead')}</div>
      {sessions.map((s) => (
        <SessionRow key={s.id} s={s} locked={s.source === lockedSource} onPick={onPick} />
      ))}
    </div>
  )
}

// @@@ SpecNode - two stacked rows, not a card. ROW 1 (the original thin file-tree line): status dot +
// title + version + overlay marks. ROW 2: the live editors' avatars, or "last edited … ago" (EditorRow).
// The tree flows left->right, so handles are on the sides. When a worktree has a PENDING change to this
// node (from /api/board overlays), it carries `overlays`: the node takes the author session's colour
// (dashed ring = uncommitted, solid = committed) and shows op glyphs. An `added` node not yet on main
// renders as a translucent ghost. When the node's author session is LIVE (App decorates `data.link`), it
// stamps a subtle ⏎ in that session's colour — clicking the node (or Enter) opens that session.
export default function SpecNode({ data, selected }) {
  const t = useT()
  const s = STATUS[data.status] || STATUS.pending
  const overlays = data.overlays || []
  const lead = overlays[0]                                   // primary author -> ring colour
  const deleted = overlays.some((o) => o.op === 'deleted')
  const dirty = lead && !lead.committed                      // uncommitted -> dashed ring
  const ops = [...new Set(overlays.map((o) => o.op))]
  const cls = [
    'spec-node', data.status,
    selected ? 'focused' : '',
    data.ghost ? 'ghost' : '',
    deleted ? 'deleted' : '',
    overlays.length ? 'has-overlay' : '',
    dirty ? 'ov-dirty' : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={cls} style={lead ? { '--ov': labelColor(lead.seed) } : undefined}>
      <Handle type="target" position={Position.Left} />
      <div className="node-row1">
        <span className="node-dot" style={{ background: s.color }}>
          {data.status === 'active' && <span className="pulse" style={{ background: s.color }} />}
        </span>
        <span className="node-title">{data.title}</span>
        {data.link && (
          <span className="node-session" style={{ color: data.link.color }}
            title={t('specNode.liveSession', { status: t(`status.${data.link.status}`) })}>⏎</span>
        )}
        {data.drift > 0 && (
          <span className="drift-badge" title={(data.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')}>
            ⚠{data.drift}
          </span>
        )}
        <IssueBadge issues={data.openIssues} t={t} />
        <span className="node-ver">{data.version ? `v${data.version}` : ''}</span>
        {ops.length > 0 && (
          <span className="ov-marks" title={overlays.map((o) => t('specNode.opTitle', { op: t(`legend.opRows.${o.op}`), label: o.label, uncommitted: !o.committed })).join('\n')}>
            {ops.map((op) => <span key={op} className={`ov-mark ov-${op}`}>{GLYPH[op]}</span>)}
          </span>
        )}
      </div>
      <div className="node-row2">
        <EditorRow data={data} />
      </div>
      <IssuePopover issues={data.openIssues} t={t} />
      {/* the on-graph review window: the live session(s) changing this node, each a click away from
          locking the graph onto it. Makes a pending change (esp. an empty ghost) reviewable in place. */}
      <SessionPeek sessions={data.editors} onPick={data.onPickSession} lockedSource={data.lockedSource} t={t} />
      {/* expandable hint — a collapsed node (children hidden to the right) gets a ▸N tab on its right
          edge so a leaf and a closed branch never look alike. App sets data.collapsed/childCount. */}
      {data.collapsed && (
        <span className="node-expand" title={t('specNode.expandable', { n: data.childCount })}>▸{data.childCount}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
