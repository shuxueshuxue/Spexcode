import { Handle, Position } from '@xyflow/react'

const STATUS = {
  merged:  { color: '#859900' },
  active:  { color: '#cb4b16' },
  pending: { color: '#93a1a1' },
}

// @@@ SpecNode - one thin row, not a card: status dot + title + version. Dense file-tree feel;
// the tree flows left->right, so handles are on the sides. Screenshots live in the evidence pane.
export default function SpecNode({ data, selected }) {
  const s = STATUS[data.status]
  return (
    <div className={`spec-node ${data.status} ${selected ? 'focused' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className="node-dot" style={{ background: s.color }}>
        {data.status === 'active' && <span className="pulse" style={{ background: s.color }} />}
      </span>
      <span className="node-title">{data.title}</span>
      <span className="node-ver">{data.version ? `v${data.version}` : ''}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
