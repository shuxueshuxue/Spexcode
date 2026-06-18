// @@@ mock backend - what's left here is the client-side view decoration + a stand-in session log.
// - spec tree   -> reading .spec on `main` (the source of truth, via /api/specs)
// - session     -> the worktree linker (`git worktree list` + .session file + `tmux capture-pane`)
// - evidence    -> A->B links served from the backend (`evidence:` frontmatter); none until yatsu.
//   (No placeholder screenshots are fabricated here anymore — absent evidence reads as "none".)

// @@@ session log - fake tmux scrollback. for the active nodes it mirrors the REAL work from
// our conversation; root is the meta session (this very chat) building the whole board.
const LOGS = {
  'sess-meta': [
    `\x1b[90m$ claude --resume   worktree node/root · this conversation\x1b[0m`,
    `\x1b[36m● spec:\x1b[0m spec-dashboard  \x1b[90mv5 → v6\x1b[0m`,
    ``,
    `\x1b[35m✻\x1b[0m we are designing this board together, right now.`,
    `\x1b[35m✻\x1b[0m every node below is a real thread from our chat.`,
    `\x1b[33m⧗ recursion:\x1b[0m the dashboard renders its own making.`,
    ``,
    `\x1b[90m  children: source-of-truth · dashboard-ui · yatsu-evidence\x1b[0m`,
    `\x1b[90m  next: wire the real backend behind src/data.js\x1b[0m`,
    ``,
  ],
  'sess-1c9d': [
    `\x1b[90m$ claude --resume   worktree node/keyboard-nav\x1b[0m`,
    `\x1b[36m● spec:\x1b[0m keyboard-nav  \x1b[90mv1 → v2\x1b[0m`,
    `\x1b[90m  user: "it jumps too high when switching nodes"\x1b[0m`,
    ``,
    `\x1b[35m✻\x1b[0m the Van Wijk zoom arc + forced zoom:1.15 cause the hop`,
    `\x1b[32m● Edit\x1b[0m src/App.jsx  flyTo: setCenter → flat rAF pan \x1b[90m(+18 -3)\x1b[0m`,
    `\x1b[32m● Bash\x1b[0m npm run build  \x1b[90m… ✓ built in 995ms\x1b[0m`,
    `\x1b[33m⧗ yatsu\x1b[0m recording B: a flat glide between nodes`,
    ``,
  ],
  'sess-7f3a': [
    `\x1b[90m$ claude --resume   worktree node/session-peek\x1b[0m`,
    `\x1b[36m● spec:\x1b[0m session-peek  \x1b[90mv1 → v2\x1b[0m`,
    `\x1b[90m  user: "Esc doesn't jump out of the peek"\x1b[0m`,
    ``,
    `\x1b[35m✻\x1b[0m xterm grabs focus; window keydown never sees Escape`,
    `\x1b[32m● Edit\x1b[0m src/PeekPanel.jsx  attachCustomKeyEventHandler \x1b[90m(+6)\x1b[0m`,
    `\x1b[32m● Bash\x1b[0m npm run build  \x1b[90m… ✓\x1b[0m`,
    `\x1b[90m  (you just used it to get here — press esc to leave)\x1b[0m`,
    ``,
  ],
  'sess-b412': [
    `\x1b[90m$ claude --resume   worktree node/ab-screenshots\x1b[0m`,
    `\x1b[36m● spec:\x1b[0m ab-screenshots  \x1b[90mv1\x1b[0m`,
    ``,
    `\x1b[35m✻\x1b[0m rendering before/after as inline SVG (no binary assets)`,
    `\x1b[32m● Edit\x1b[0m src/data.js  svgShot()  \x1b[90m(+22)\x1b[0m`,
    `\x1b[33m⧗ yatsu\x1b[0m would drive a desktop container to capture the real GUI A→B`,
    ``,
  ],
}

// @@@ begin-log - a spec is always the latest ground truth: no node is ever "closed".
// Opening one with no live session just lets the agent start working on its content in place.
function log(node) {
  const lines = LOGS[node.session] || [
    `\x1b[90m$ claude   worktree node/${node.id}  (branch node/${node.id})\x1b[0m`,
    `\x1b[36m● spec:\x1b[0m ${node.title}  \x1b[90mv${node.version || 0}\x1b[0m`,
    ``,
    `\x1b[35m✻\x1b[0m no live session yet — this spec is the latest ground truth.`,
    `\x1b[35m✻\x1b[0m structure is fixed; content changes in place.`,
    `\x1b[35m✻\x1b[0m start typing to let the agent begin working on it.`,
    ``,
  ]
  return [...lines, `\x1b[36mtype here — keystrokes forward via\x1b[0m \x1b[1msend-keys\x1b[0m`, ``]
}

// @@@ tidy-tree layout - left->right: depth sets the column (x), post-order stacks leaves into
// rows (y), parents centre vertically over their kids. Root at the left, subtrees extend right.
// Rows are tight because a node is a single line, so many fit on one screen.
const X_GAP = 230, Y_GAP = 34
function layout(nodes) {
  const kids = {}
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n.id) })
  const pos = {}
  let row = 0
  const place = (id, depth) => {
    const cs = kids[id] || []
    let y
    if (cs.length === 0) { y = row * Y_GAP; row++ }
    else { const ys = cs.map((c) => place(c, depth + 1)); y = (ys[0] + ys[ys.length - 1]) / 2 }
    pos[id] = { x: depth * X_GAP, y }
    return y
  }
  nodes.filter((n) => !n.parent).forEach((r) => place(r.id, 0))
  return pos
}

// @@@ loadSpecs - the tree comes from the backend (spec-cli reads .spec + git history); every field,
// including the A->B `evidence` links, is served from there. The only thing decorated client-side is
// the x/y tidy-tree layout, which is a pure view concern (the backend has no notion of pixels).
export async function loadSpecs() {
  const res = await fetch('/api/specs')
  const nodes = await res.json()
  const pos = layout(nodes)
  return nodes.map((n) => ({ ...n, ...pos[n.id] }))
}

export const SESSION_LOG = log
