import { Handle, Position } from '@xyflow/react'

const STATUS = {
  merged:  { color: '#859900' },
  active:  { color: '#cb4b16' },
  pending: { color: '#93a1a1' },
}

// the pending-op glyphs an overlay can stamp on a node.
const GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

// @@@ SpecNode - one thin row, not a card: status dot + title + version. Dense file-tree feel;
// the tree flows left->right, so handles are on the sides. When a worktree has a PENDING change to
// this node (from /api/layout `ops`, decorated in loadBoard), it carries `overlays`: the row takes
// the author session's colour (dashed ring = uncommitted, solid = committed) and shows op glyphs.
// An `added` node that isn't on main yet renders as a translucent ghost.
export default function SpecNode({ data, selected }) {
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
    <div className={cls} style={lead ? { '--ov': lead.color } : undefined}>
      <Handle type="target" position={Position.Left} />
      <span className="node-dot" style={{ background: s.color }}>
        {data.status === 'active' && <span className="pulse" style={{ background: s.color }} />}
      </span>
      <span className="node-title">{data.title}</span>
      {data.drift > 0 && (
        <span className="drift-badge" title={(data.driftFiles || []).map((d) => `${d.file}: ${d.behind} ahead`).join('\n')}>
          ⚠{data.drift}
        </span>
      )}
      <span className="node-ver">{data.version ? `v${data.version}` : ''}</span>
      {ops.length > 0 && (
        <span className="ov-marks" title={overlays.map((o) => `${o.op} · ${o.label}${o.committed ? '' : ' (uncommitted)'}`).join('\n')}>
          {ops.map((op) => <span key={op} className={`ov-mark ov-${op}`}>{GLYPH[op]}</span>)}
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
