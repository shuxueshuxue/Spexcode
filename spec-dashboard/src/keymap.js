// @@@ keymap.js - the ONE keyboard keymap registry: every board binding as data, not a literal scattered
// through the keydown handler. Two readers project from this single table so they can never drift: App's
// capture-phase handler DISPATCHES from it (via bindings.firesKey), and the help Legend RENDERS it. Add a
// verb once here and both follow.
//
// The registry owns the BINDING (which physical key names an action), never the action's BEHAVIOR — the
// handler bodies (chord buffer, focus-follow pan, scope-following cycle) stay in App.jsx. So this is a
// name→keys map, not a re-implementation of the keys.
//
// Game-controller support is deliberately NOT here: it lives entirely OUTSIDE the browser as the
// game-controller extension (its own package/repo), which maps the pad to the SAME keys this table names,
// as REAL OS keystrokes — so it reaches the board (and OS-level facilities a synthetic in-page event never
// could). The two are kept consistent BY HAND, on purpose: no runtime link, no sync.
//
// Scope: the BOARD layer (where rebinding matters). The node-info popup's internal pane-switch / scroll keys
// are a fixed structural set handled literally in App.jsx and listed separately by the Legend.
//
//   - `keys`   default keyboard key(s) (KeyboardEvent.key values).
//   - `rebind` false = structural (the relationship-walk nav, the n/d chords): shown in the UI, fixed.
//   - `desc`   i18n key for the one-line description; rows sharing a desc render as ONE legend row (so
//              up+down read as a single "move" line while staying two actions for dispatch).

export const ACT = [
  // relationship walk — structural (the nav IS the tree-walk, not a remappable verb). The capitals make
  // Shift TRANSPARENT to nav (⇧j = j, one global grammar; ⇧arrows match for free — e.key is unchanged);
  // that same shift-passthrough is what lets nav reach THROUGH the node-info popup, which claims only
  // unmodified keys ([[keyboard-nav]]'s lens exception — the popup follows the focus).
  { id: 'nav.up',      keys: ['ArrowUp', 'k', 'K'],    rebind: false, desc: 'legend.graph.move' },
  { id: 'nav.down',    keys: ['ArrowDown', 'j', 'J'],  rebind: false, desc: 'legend.graph.move' },
  { id: 'nav.parent',  keys: ['ArrowLeft', 'h', 'H'],  rebind: false, desc: 'legend.graph.parent' },
  { id: 'nav.child',   keys: ['ArrowRight', 'l', 'L'], rebind: false, desc: 'legend.graph.child' },
  // board verbs — rebindable
  { id: 'graph.zoomIn',    keys: ['+', '='], rebind: true, desc: 'legend.graph.zoom' },
  { id: 'graph.zoomOut',   keys: ['-', '_'], rebind: true, desc: 'legend.graph.zoom' },
  { id: 'graph.zoomReset', keys: ['0'],      rebind: true, desc: 'legend.graph.zoom' },
  { id: 'graph.info',      keys: ['i', 'I', 'Enter'], rebind: true, desc: 'legend.graph.info' },
  { id: 'graph.search',    keys: ['/'],      rebind: true, desc: 'legend.graph.search' },
  { id: 'graph.cycle',     keys: ['o'],      rebind: true, desc: 'legend.graph.overlayCycle' },
  { id: 'graph.cycleRev',  keys: ['O'],      rebind: true, desc: 'legend.graph.overlayCycle' },
  { id: 'graph.fresh',     keys: ['['],      rebind: true, desc: 'legend.graph.fresh' },
  { id: 'graph.evals',     keys: ['f'],      rebind: true, desc: 'legend.graph.evals' },
  // node chords — structural (a two-key grammar, not a single binding)
  { id: 'graph.newChild',  keys: ['n'],      rebind: false, desc: 'legend.graph.newChild' },
  { id: 'graph.del',       keys: ['d'],      rebind: false, desc: 'legend.graph.del' },
  // modals
  { id: 'graph.settings',  keys: [','],      rebind: true, desc: 'legend.graph.settings' },
  { id: 'graph.help',      keys: ['?'],      rebind: true, desc: 'legend.graph.help' },
]

// KeyboardEvent.key → display glyph for the keymap chips (shared by the legend and the settings editor).
export const KEY_GLYPH = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '⏎', Escape: 'esc', ' ': '␣', '-': '−' }
export const keyCap = (k) => KEY_GLYPH[k] || k
