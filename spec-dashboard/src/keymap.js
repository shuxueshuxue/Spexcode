

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
  // the page-jump vocabulary is the RAIL's order, and it lost its first entry when the graph left the rail
  // ([[side-nav]]): sessions is now ⌥1. A retired destination does not keep a digit warm.
  { id: 'shell.pageSessions',keys: ['Alt+Digit1'], rebind: false, desc: 'legend.shell.pageSessions' },
  { id: 'shell.pageEvals',   keys: ['Alt+Digit2'], rebind: false, desc: 'legend.shell.pageEvals' },
  { id: 'shell.pageIssues',  keys: ['Alt+Digit3'], rebind: false, desc: 'legend.shell.pageIssues' },
  { id: 'shell.pageSettings',keys: ['Alt+Digit4'], rebind: false, desc: 'legend.shell.pageSettings' },
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
