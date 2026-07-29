

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
