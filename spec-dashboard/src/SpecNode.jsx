import { Handle, Position } from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
import { ScenarioCount } from './score.jsx'
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
// = code ahead of spec, this = work pointing AT the node. This is purely the GLANCE; the DETAIL (the issue
// list, alongside the node's scenarios) lives in the [[focus-panel]] for the focused node — no longer a
// card popped on the node itself, so Issues and Scenarios share one place and one status.
function IssueBadge({ issues, t }) {
  if (!issues || issues.length === 0) return null
  return <span className="issue-badge" title={t('specNode.openIssues', { n: issues.length })}>◆{issues.length}</span>
}

// @@@ SpecNode - two stacked rows, not a card. ROW 1 (the original thin file-tree line): status dot +
// title + version + overlay marks. ROW 2: the live editors' avatars, or "last edited … ago" (EditorRow).
// The tree flows left->right, so handles are on the sides. When a worktree has a PENDING change to this
// node (from /api/board overlays), it carries `overlays`: the node takes the author session's colour
// (dashed ring = uncommitted, solid = committed) and shows op glyphs. An `added` node not yet on main
// renders as a translucent ghost.
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
        {data.drift > 0 && (
          <span className="drift-badge" title={(data.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')}>
            ⚠{data.drift}
          </span>
        )}
        <IssueBadge issues={data.openIssues} t={t} />
        <ScenarioCount scenarios={data.scenarios} evals={data.evals} />
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
      {/* expandable hint — a collapsed node (children hidden to the right) gets a ▸N tab on its right
          edge so a leaf and a closed branch never look alike. App sets data.collapsed/childCount. */}
      {data.collapsed && (
        <span className="node-expand" title={t('specNode.expandable', { n: data.childCount })}>▸{data.childCount}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
