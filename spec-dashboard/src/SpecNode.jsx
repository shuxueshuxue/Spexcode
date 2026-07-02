import { Handle, Position } from '@xyflow/react'
import { Avatar } from './avatar.jsx'
import { labelColor } from './color.js'
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

function Editors({ data }) {
  const t = useT()
  const editors = data.editors || []
  if (editors.length === 0) return null
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

function IssueBadge({ issues, t }) {
  if (!issues || issues.length === 0) return null
  return <span className="issue-badge" title={t('specNode.openIssues', { n: issues.length })}>◆{issues.length}</span>
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
      <Handle type="target" position={Position.Left} />
      <div className="node-row1">
        <span className="node-dot" style={{ background: s.color }}>
          {data.status === 'active' && <span className="pulse" style={{ background: s.color }} />}
        </span>
        <span className="node-title">{data.title}</span>
        {ago && <span className="node-ago">{ago}</span>}
      </div>
      <div className="node-row2">
        <span className="node-ver">{data.version ? `v${data.version}` : ''}</span>
        {data.drift > 0 && (
          <span className="drift-badge" title={(data.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')}>
            ⚠{data.drift}
          </span>
        )}
        <IssueBadge issues={data.openIssues} t={t} />
        <ScenarioCount scenarios={data.scenarios} evals={data.evals} />
        {ops.length > 0 && (
          <span className="ov-marks" title={overlays.map((o) => t('specNode.opTitle', { op: t(`legend.opRows.${o.op}`), label: o.label, uncommitted: !o.committed })).join('\n')}>
            {ops.map((op) => <span key={op} className={`ov-mark ov-${op}`}>{GLYPH[op]}</span>)}
          </span>
        )}
        <Editors data={data} />
      </div>
      {/* collapsed node gets a ▸N tab naming its hidden child count (App sets data.collapsed/childCount). */}
      {data.collapsed && (
        <span className="node-expand" title={t('specNode.expandable', { n: data.childCount })}>▸{data.childCount}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
