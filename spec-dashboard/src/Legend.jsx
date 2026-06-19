import { STATUS, GLYPH } from './SpecNode.jsx'

// @@@ Legend - a floating corner card that decodes the node visual vocabulary. It reads STATUS and
// GLYPH straight from SpecNode.jsx (the node renderer), so the swatches can NEVER drift from what the
// board actually draws — change a colour or glyph there and the legend follows. Toggled by `?` in App.

// status dot meanings — keyed off STATUS so the colour is always the live one.
const STATUS_ROWS = [
  ['merged',  'spec & code in sync'],
  ['active',  'in-flight — the dot pulses'],
  ['drift',   'governed code is ahead of its spec'],
  ['pending', 'no committed version yet'],
]

// overlay op glyphs — keyed off GLYPH; each is a worktree's pending change to a node.
const OP_ROWS = [
  ['added',   'added'],
  ['edited',  'edited'],
  ['deleted', 'deleted'],
  ['moved',   'moved'],
]

export default function Legend({ onClose }) {
  return (
    <div className="legend" role="dialog" aria-label="legend">
      <div className="legend-head">
        <span className="legend-title">legend</span>
        <button className="legend-close" onClick={onClose} title="close (? or esc)">×</button>
      </div>
      <div className="legend-body">
        <section className="legend-sec">
          <div className="legend-h">status dot</div>
          {STATUS_ROWS.map(([k, desc]) => (
            <div className="legend-row" key={k}>
              <span className="node-dot" style={{ background: STATUS[k].color }}>
                {k === 'active' && <span className="pulse" style={{ background: STATUS[k].color }} />}
              </span>
              <span className="legend-name">{k}</span>
              <span className="legend-desc">{desc}</span>
            </div>
          ))}
        </section>

        <section className="legend-sec">
          <div className="legend-h">overlay op <span className="legend-sub">(a worktree's pending change)</span></div>
          {OP_ROWS.map(([k, desc]) => (
            <div className="legend-row" key={k}>
              <span className={`ov-mark ov-${k}`}>{GLYPH[k]}</span>
              <span className="legend-desc">{desc}</span>
            </div>
          ))}
        </section>

        <section className="legend-sec">
          <div className="legend-h">badges</div>
          <div className="legend-row">
            <span className="legend-glyph">⏎</span>
            <span className="legend-desc">a live session is editing this node (shown in that session's colour) — click the node or press Enter to open it</span>
          </div>
          <div className="legend-row">
            <span className="drift-badge">⚠N</span>
            <span className="legend-desc">drift: N commits of code ahead of the spec</span>
          </div>
          <div className="legend-row">
            <span className="legend-glyph legend-ver">vN</span>
            <span className="legend-desc">version: N content commits to the node's spec.md</span>
          </div>
        </section>

        <section className="legend-sec">
          <div className="legend-h">node ring</div>
          <div className="legend-row">
            <span className="legend-ring ring-dashed" />
            <span className="legend-desc">dashed = uncommitted overlay</span>
          </div>
          <div className="legend-row">
            <span className="legend-ring ring-solid" />
            <span className="legend-desc">solid = committed; ring colour = the author session</span>
          </div>
          <div className="legend-row">
            <span className="legend-ring ring-ghost" />
            <span className="legend-desc">translucent “ghost” = an added node not yet on main</span>
          </div>
        </section>
      </div>
    </div>
  )
}
