import { STATUS, GLYPH } from './SpecNode.jsx'

// @@@ Legend - the single home for the keymap + visual vocabulary, shown as a CENTERED, scrollable
// modal opened by the HUD's discreet `?` (key or click). It reads STATUS and GLYPH straight from
// SpecNode.jsx (the node renderer), so the swatches can NEVER drift from what the board actually
// draws — change a colour or glyph there and the legend follows. The backdrop closes on click; the
// inner panel stops propagation so clicks inside don't close it. Esc / `?` / × also close (see App).

// keymap — kept in sync with App.jsx's keydown handler (the prose contract lives in the keyboard-nav spec).
const BOARD_KEYS = [
  [['↑', 'k', '↓', 'j'], 'move up / down the focused column (siblings)'],
  [['←', 'h'], 'to the parent'],
  [['→', 'l'], 'to the nearest child'],
  [['+', '−', '0'], 'zoom in / out · reset to overview'],
  [['i'], 'open the node-info popup (or double-click a node)'],
  [['⏎'], 'cross into the focus node’s live session'],
  [['n', 'n'], 'new child node under the focus (chord)'],
  [['d', 'd'], 'delete the focused node (chord)'],
  [['?'], 'open this help'],
]
const POPUP_KEYS = [
  [['←', '→', 'h', 'l', '⇥', '1', '2', '3'], 'switch pane (spec / recent / history)'],
  [['j', 'k'], 'scroll the open pane'],
  [['⏎'], 'cross to the node’s session'],
  [['esc'], 'close the popup'],
]

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

function KeymapSection({ title, rows }) {
  return (
    <section className="legend-sec">
      <div className="legend-h">{title}</div>
      {rows.map(([keys, desc]) => (
        <div className="legend-row" key={desc}>
          <span className="keymap-keys">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>
          <span className="legend-desc">{desc}</span>
        </div>
      ))}
    </section>
  )
}

export default function Legend({ onClose }) {
  return (
    <div className="legend-backdrop" onClick={onClose}>
      <div className="legend" role="dialog" aria-modal="true" aria-label="help" onClick={(e) => e.stopPropagation()}>
        <div className="legend-head">
          <span className="legend-title">help · keymap & legend</span>
          <button className="legend-close" onClick={onClose} title="close (esc or ?)">×</button>
        </div>
        <div className="legend-body">
          <KeymapSection title="board keys" rows={BOARD_KEYS} />
          <KeymapSection title="node-info popup" rows={POPUP_KEYS} />

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
    </div>
  )
}
