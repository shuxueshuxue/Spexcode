// @@@ keymap.js - the ONE keymap registry: every board binding as data, not a literal scattered through
// the keydown handler. Three readers project from this single table so they can never drift: App's
// capture-phase handler DISPATCHES from it (via bindings.resolve), the help Legend RENDERS it, and the
// game-controller (gamepad.js) maps a pad button to the same action. Add a verb once here and all three
// follow.
//
// The registry owns the BINDING (which physical key / pad button names an action), never the action's
// BEHAVIOR — the handler bodies (chord buffer, focus-follow pan, scope-following cycle) stay in App.jsx.
// So this is a name→keys map, not a re-implementation of the keys.
//
// Scope: the BOARD layer (where rebinding + the controller actually matter). The node-info popup's
// internal pane-switch / scroll keys are a fixed structural set handled literally in App.jsx and listed
// separately by the Legend — they are not rebindable and not in this table.
//
//   - `keys`   default keyboard key(s) (KeyboardEvent.key values); the first is the one the controller synthesizes.
//   - `pad`    default controller button as a short token shared with gamepad.js + the UI (''=no button):
//                face A B X Y · bumpers LB RB · triggers LT RT · stick-clicks L3 R3 · dpad Up Down Left Right · Start Select
//   - `rebind` false = structural (the relationship-walk nav, the n/d chords): shown in the UI, fixed.
//   - `desc`   i18n key for the one-line description; rows sharing a desc render as ONE legend row (so
//              up+down read as a single "move" line while staying two actions for dispatch + the d-pad).

export const ACT = [
  // relationship walk — structural (the nav IS the tree-walk, not a remappable verb)
  { id: 'nav.up',      keys: ['ArrowUp', 'k'],    pad: 'Up',    rebind: false, desc: 'legend.board.move' },
  { id: 'nav.down',    keys: ['ArrowDown', 'j'],  pad: 'Down',  rebind: false, desc: 'legend.board.move' },
  { id: 'nav.parent',  keys: ['ArrowLeft', 'h'],  pad: 'Left',  rebind: false, desc: 'legend.board.parent' },
  { id: 'nav.child',   keys: ['ArrowRight', 'l'], pad: 'Right', rebind: false, desc: 'legend.board.child' },
  // board verbs — rebindable
  { id: 'board.zoomIn',    keys: ['+', '='], pad: 'RT', rebind: true, desc: 'legend.board.zoom' },
  { id: 'board.zoomOut',   keys: ['-', '_'], pad: 'LT', rebind: true, desc: 'legend.board.zoom' },
  { id: 'board.zoomReset', keys: ['0'],      pad: 'R3', rebind: true, desc: 'legend.board.zoom' },
  { id: 'board.info',      keys: ['i', 'I'], pad: 'X',  rebind: true, desc: 'legend.board.info' },
  { id: 'board.search',    keys: ['/'],      pad: 'Y',  rebind: true, desc: 'legend.board.search' },
  { id: 'board.cycle',     keys: ['o'],      pad: 'RB', rebind: true, desc: 'legend.board.overlayCycle' },
  { id: 'board.cycleRev',  keys: ['O'],      pad: 'LB', rebind: true, desc: 'legend.board.overlayCycle' },
  { id: 'board.enter',     keys: ['Enter'],  pad: 'A',  rebind: true, desc: 'legend.board.enter' },
  { id: 'board.fresh',     keys: ['@'],      pad: 'Start', rebind: true, desc: 'legend.board.fresh' },
  // node chords — structural (a two-key grammar, not a single binding)
  { id: 'board.newChild',  keys: ['n'],      pad: '',   rebind: false, desc: 'legend.board.newChild' },
  { id: 'board.del',       keys: ['d'],      pad: '',   rebind: false, desc: 'legend.board.del' },
  // modals
  { id: 'board.settings',  keys: [','],      pad: 'Select', rebind: true, desc: 'legend.board.settings' },
  { id: 'board.help',      keys: ['?'],      pad: 'L3', rebind: true, desc: 'legend.board.help' },
]

// pad token → a readable glyph for the UI (keyboard `kbd` chips show the token's face).
export const PAD_GLYPH = {
  Up: '⬆', Down: '⬇', Left: '⬅', Right: '➡',
  A: 'A', B: 'B', X: 'X', Y: 'Y',
  LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', L3: 'L3', R3: 'R3',
  Start: '☰', Select: '⧉',
}

// KeyboardEvent.key → display glyph for the keymap chips (shared by the legend and the settings editor).
export const KEY_GLYPH = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '⏎', Escape: 'esc', ' ': '␣', '-': '−' }
export const keyCap = (k) => KEY_GLYPH[k] || k
export const padCap = (tok) => (tok ? PAD_GLYPH[tok] || tok : '')
