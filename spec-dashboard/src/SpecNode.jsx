import { Handle, Position } from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { avatarColors, labelColor } from './color.js'
import { ScenarioCount } from './score.jsx'
import { useT } from './i18n/index.jsx'

// compact "Nm/Nh/Nd ago"; returns null for a missing/unparseable date so the caller can render nothing.
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
const EDGE_ANCHOR_PROPS = {
  isConnectable: false,
  isConnectableStart: false,
  isConnectableEnd: false,
  style: { pointerEvents: 'none' },
  'aria-hidden': true,
}

// STATUS/GLYPH live in specMeta.js (dependency-free) so light chunks — the mobile face, the session
// window rows — read them without pulling this tile (and thus xyflow) into their bundle; re-exported
// here so the graph side keeps its one import site.
export { STATUS, GLYPH } from './specMeta.js'
import { STATUS, GLYPH } from './specMeta.js'

function Editors({ data }) {
  const t = useT()
  // several pending ops from one session collapse to one face — dedupe by id
  const editors = [...new Map((data.editors || []).map((e) => [e.id, e])).values()]
  if (editors.length === 0) return null
  const shown = editors.slice(0, MAX_AVATARS)
  const extra = editors.length - shown.length
  return (
    <span className="node-editors" data-tip={t('specNode.liveEditors', { n: editors.length })}>
      {shown.map((e) => (
        <Avatar key={e.id} seed={e.id} status={e.status}
          title={t('specNode.editorTitle', { node: e.node || t('common.session'), status: t(`status.${e.status}`), id: e.id.slice(0, 8) })} />
      ))}
      {extra > 0 && <span className="av-more" data-tip={t('specNode.more', { n: extra })}>+{extra}</span>}
    </span>
  )
}

function IssueBadge({ summary, t }) {
  if (!summary?.open) return null
  return <span className="issue-badge" data-tip={t('specNode.openIssues', { n: summary.open })}>◆{summary.open}</span>
}

// The ▸N tab of a collapsed node. Structural on its own (the hidden direct-child count), it also
// advertises the ACTIVITY inside: filled in the lead hidden author's hue with one dot per session at
// work in there, so a busy closed branch never reads as a quiet one. Fill survives the zoom that digits
// do not, which is why the tint carries the signal and the counts stay detail. `data.hidden` is
// descendant-only — this node's own overlay is already row 1's business.
function CollapsedTab({ data, t }) {
  const inside = data.hidden || []
  const shown = inside.slice(0, 3)
  const extra = inside.length - shown.length
  const nodes = data.hiddenNodes || 0            // distinct nodes in motion in there, not a sum of the per-session tallies
  // the lead author's hue at the avatar face's lightness/saturation — that pair is already the project's
  // answer to "a fill and a legible mark on it at an arbitrary hue", and white-on-hue is not (a yellow
  // session gave white text nothing to sit on). Same hue as the ring, so the tab still names the session.
  const face = inside.length ? avatarColors(inside[0].seed) : null
  return (
    <span
      className={`node-expand${inside.length ? ' has-hidden' : ''}`}
      style={face ? { '--ovh': face.bg, '--ovh-fg': face.fg, '--ovh-ring': labelColor(inside[0].seed) } : undefined}
      data-tip={inside.length
        ? [t('specNode.expandable', { n: data.childCount }),
           t('specNode.hiddenActive', { nodes, sessions: inside.length }),
           ...inside.map((e) => t('specNode.hiddenAuthor', { label: e.label, n: e.nodes }))].join('\n')
        : t('specNode.expandable', { n: data.childCount })}
    >
      ▸{data.childCount}
      {inside.length > 0 && (
        <span className="hidden-dots">
          {shown.map((e) => <i key={e.source} style={{ background: labelColor(e.seed) }} />)}
          {extra > 0 && `+${extra}`}
        </span>
      )}
    </span>
  )
}

export default function SpecNode({ data, selected }) {
  const t = useT()
  const s = STATUS[data.status] || STATUS.pending
  const ago = timeAgo(data.lastEdited, t)
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
      <Handle type="target" position={Position.Left} {...EDGE_ANCHOR_PROPS} />
      <div className="node-row1">
        <span className="node-dot" style={{ background: s.color }}>
          {data.status === 'active' && <span className="pulse" style={{ background: s.color }} />}
        </span>
        <span className="node-title">{data.title}</span>
        {/* pending ops replace the age — an overlay means the node is being touched NOW */}
        {ops.length > 0 ? (
          <span className="ov-marks" data-tip={overlays.map((o) => t('specNode.opTitle', { op: t(`legend.opRows.${o.op}`), label: o.label, uncommitted: !o.committed })).join('\n')}>
            {ops.map((op) => <span key={op} className={`ov-mark ov-${op}`}>{GLYPH[op]}</span>)}
          </span>
        ) : ago ? <span className="node-ago">{ago}</span> : null}
      </div>
      <div className="node-row2">
        <span className="node-ver">{data.version ? `v${data.version}` : ''}</span>
        {data.drift > 0 && (
          <span className="drift-badge" data-tip={(data.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')}>
            ⚠{data.drift}
          </span>
        )}
        <IssueBadge summary={data.reviewSummary?.issues} t={t} />
        <ScenarioCount summary={data.reviewSummary?.evals} />
        <Editors data={data} />
      </div>
      {/* collapsed node gets a ▸N tab naming its hidden child count, lit when a hidden descendant is being worked on. */}
      {data.collapsed && <CollapsedTab data={data} t={t} />}
      <Handle type="source" position={Position.Right} {...EDGE_ANCHOR_PROPS} />
    </div>
  )
}
