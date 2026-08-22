

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
  { id: 'shell.pageGraph',   keys: ['Alt+Digit1'], rebind: false, desc: 'legend.shell.pageGraph' },
  { id: 'shell.pageSessions',keys: ['Alt+Digit2'], rebind: false, desc: 'legend.shell.pageSessions' },
  { id: 'shell.pageEvals',   keys: ['Alt+Digit3'], rebind: false, desc: 'legend.shell.pageEvals' },
  { id: 'shell.pageIssues',  keys: ['Alt+Digit4'], rebind: false, desc: 'legend.shell.pageIssues' },
  { id: 'shell.pageSettings',keys: ['Alt+Digit5'], rebind: false, desc: 'legend.shell.pageSettings' },
  { id: 'shell.newSession',  keys: ['Alt+KeyN'],   rebind: false, desc: 'legend.shell.newSession' },
  { id: 'shell.evals',       keys: ['Alt+KeyF'],   rebind: false, desc: 'legend.shell.evals' },
  { id: 'shell.search',      keys: ['Alt+Slash'],  rebind: false, desc: 'legend.shell.search' },
  // shell commands — fixed Alt+Shift chords keep Ctrl/Meta browser accelerators untouched.
  { id: 'shell.dockToggle',   keys: ['Alt+Shift+KeyE'],          rebind: false, desc: 'legend.shell.dockToggle' },
  { id: 'shell.dockMode',     keys: ['Alt+Shift+KeyM'],          rebind: false, desc: 'legend.shell.dockMode' },
  { id: 'shell.contextToggle',keys: ['Alt+Shift+KeyC'],          rebind: false, desc: 'legend.shell.contextToggle' },
  { id: 'shell.tabClose',     keys: ['Alt+Shift+KeyX'],          rebind: false, desc: 'legend.shell.tabClose' },
  { id: 'shell.tabNext',      keys: ['Alt+Shift+ArrowRight'],    rebind: false, desc: 'legend.shell.tabNext' },
  { id: 'shell.tabPrevious',  keys: ['Alt+Shift+ArrowLeft'],     rebind: false, desc: 'legend.shell.tabPrevious' },
  { id: 'shell.tabSplit',     keys: ['Alt+Shift+Enter'],         rebind: false, desc: 'legend.shell.tabSplit' },
]

// KeyboardEvent.key → display glyph for the keymap chips (shared by the legend and the settings editor).
export const KEY_GLYPH = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '⏎', Escape: 'esc', ' ': '␣', '-': '−',
  'Alt+Shift+KeyE': '⌥⇧E', 'Alt+Shift+KeyM': '⌥⇧M', 'Alt+Shift+KeyC': '⌥⇧C', 'Alt+Shift+KeyX': '⌥⇧X',
  'Alt+Shift+ArrowRight': '⌥⇧→', 'Alt+Shift+ArrowLeft': '⌥⇧←', 'Alt+Shift+Enter': '⌥⇧⏎',
  'Alt+Digit1': '⌥1', 'Alt+Digit2': '⌥2', 'Alt+Digit3': '⌥3', 'Alt+Digit4': '⌥4', 'Alt+Digit5': '⌥5',
  'Alt+KeyN': '⌥N', 'Alt+KeyF': '⌥F', 'Alt+Slash': '⌥/',
}
export const keyCap = (k) => KEY_GLYPH[k] || k
