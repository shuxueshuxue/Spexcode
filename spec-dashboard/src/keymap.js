

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
  // node chords — structural (a two-key grammar, not a single binding). `keys` is the leader that starts
  // the state machine; `sequence` is the complete physical grammar used by dispatch and every reader.
  { id: 'graph.newChild',  keys: ['n'], sequence: ['n', 'n'], rebind: false, desc: 'legend.graph.newChild' },
  { id: 'graph.del',       keys: ['d'], sequence: ['d', 'd'], rebind: false, desc: 'legend.graph.del' },
  // modals
  { id: 'graph.settings',  keys: [','],      rebind: true, desc: 'legend.graph.settings' },
  { id: 'graph.help',      keys: ['?'],      rebind: true, desc: 'legend.graph.help' },
  // No positional page-jump row. A digit named a rail SLOT, so every rail change renumbered the whole set
  // and the hint a control printed stopped matching the finger that learned it ([[side-nav]]). The named
  // doors below survive a reorder because they name a destination, not a position.
  { id: 'shell.newSession',  keys: ['Alt+KeyN'],   rebind: false, desc: 'legend.shell.newSession' },
  { id: 'shell.evals',       keys: ['Alt+KeyF'],   rebind: false, desc: 'legend.shell.evals' },
  { id: 'shell.search',      keys: ['Alt+Slash'],  rebind: false, desc: 'legend.shell.search' },
  { id: 'shell.sessionPrevious', keys: ['Alt+ArrowUp'], rebind: false, desc: 'legend.shell.sessionPrevious' },
  { id: 'shell.sessionNext',     keys: ['Alt+ArrowDown'], rebind: false, desc: 'legend.shell.sessionNext' },
  { id: 'shell.sessionExpand',   keys: ['Alt+Shift+ArrowDown'], rebind: false, desc: 'legend.shell.sessionExpand' },
  { id: 'shell.sessionCollapse', keys: ['Alt+Shift+ArrowUp'], rebind: false, desc: 'legend.shell.sessionCollapse' },
  // shell commands — fixed Alt+Shift chords keep Ctrl/Meta browser accelerators untouched.
  { id: 'shell.dockToggle',   keys: ['Alt+Shift+KeyE'],          rebind: false, desc: 'legend.shell.dockToggle' },
  { id: 'shell.dockMode',     keys: ['Alt+Shift+KeyM'],          rebind: false, desc: 'legend.shell.dockMode' },
  { id: 'shell.contextToggle',keys: ['Alt+Shift+KeyC'],          rebind: false, desc: 'legend.shell.contextToggle' },
  { id: 'shell.tabClose',     keys: ['Alt+Shift+KeyX'],          rebind: false, desc: 'legend.shell.tabClose' },
  { id: 'shell.tabNext',      keys: ['Alt+Shift+ArrowRight'],    rebind: false, desc: 'legend.shell.tabNext' },
  { id: 'shell.tabPrevious',  keys: ['Alt+Shift+ArrowLeft'],     rebind: false, desc: 'legend.shell.tabPrevious' },
  { id: 'shell.tabHold',      keys: ['Alt+Shift+KeyP'],          rebind: false, desc: 'legend.shell.tabHold' },
  { id: 'shell.tabSplit',     keys: ['Alt+Shift+Enter'],         rebind: false, desc: 'legend.shell.tabSplit' },
  // The console's Command Box chord was matched inline in the session console's own key handler and was
  // therefore invisible to every reader of this table — the legend, the settings editor, and (since a
  // tooltip became one) the hint the console printed for it. A binding the registry does not hold is a
  // binding nothing can render truthfully.
  { id: 'shell.commandBox',   keys: ['Alt+KeyI'],                rebind: false, desc: 'legend.shell.commandBox' },
]

// display glyph for one binding token. Single keys that need a name of their own are listed; every CHORD is
// DERIVED — `Alt+Shift+ArrowRight` → `⌥⇧→` — because a per-chord table is a second place a modifier can go
// missing, and one did: a chord absent from it printed its raw `Alt+KeyI` spelling, or nothing at all.
const KEY_GLYPH_SINGLE = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '⏎', Escape: 'esc', ' ': '␣', '-': '−',
}
const MOD_GLYPH = { Alt: '⌥', Ctrl: '⌃', Meta: '⌘', Shift: '⇧' }
// KeyboardEvent.code → the character that key prints, for the codes a chord can name. `KeyX`/`DigitN` fold
// to their own letter/digit; the punctuation codes have to be spelled out.
const CODE_GLYPH = {
  Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Backquote: '`',
  Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Space: '␣',
}
const capOne = (token) => KEY_GLYPH_SINGLE[token] || CODE_GLYPH[token]
  || token.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1')

export const keyCap = (k) => {
  if (typeof k !== 'string' || !k) return ''
  if (!k.includes('+')) return capOne(k)
  const parts = k.split('+')
  const key = parts.pop()
  return parts.map((mod) => MOD_GLYPH[mod] || `${mod}+`).join('') + capOne(key)
}

const byId = Object.fromEntries(ACT.map((action) => [action.id, action]))

// A structural chord has one leader for the state machine and a complete sequence for its readers. Keeping
// this lookup beside ACT means dispatch cannot silently grow a second spelling of the same gesture.
export const chordSequence = (id) => byId[id]?.sequence || []

// Structural chords display their complete sequence. Rebindable actions display the live resolved keys,
// otherwise a localStorage override silently disappears from both the legend and Settings.
export const displayKeysOf = (action, resolved = null) => action?.rebind
  ? (resolved || action.keys || [])
  : (action?.sequence ? [action.sequence.join('')] : (action?.keys || []))
