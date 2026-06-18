// @@@ mock backend - everything here is what the real git/worktree/tmux/yatsu layer would feed in.
// - spec tree   -> reading .spec on `main` (the source of truth)
// - session     -> the worktree linker (`git worktree list` + .session file + `tmux capture-pane`)
// - shots A/B   -> yatsu computer-use evidence, A = prev version, B = this version

// @@@ svgShot - generate a fake GUI screenshot as a data-uri, no binary assets needed.
// `after` adds a colored control + a check badge so the A->B change reads at a glance.
function svgShot({ title, hue, after }) {
  const accent = `hsl(${hue} 80% 60%)`
  const btn = after ? accent : '#3a3f4b'
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
  <rect width="320" height="200" rx="8" fill="#0d1117"/>
  <rect width="320" height="28" rx="8" fill="#161b22"/>
  <circle cx="16" cy="14" r="5" fill="#ff5f56"/>
  <circle cx="34" cy="14" r="5" fill="#ffbd2e"/>
  <circle cx="52" cy="14" r="5" fill="#27c93f"/>
  <text x="160" y="18" fill="#8b949e" font-family="monospace" font-size="11" text-anchor="middle">${title}</text>
  <rect x="24" y="52" width="200" height="12" rx="6" fill="#21262d"/>
  <rect x="24" y="76" width="150" height="12" rx="6" fill="#21262d"/>
  <rect x="24" y="120" width="110" height="34" rx="6" fill="${btn}"/>
  <text x="79" y="142" fill="${after ? '#0d1117' : '#6e7681'}" font-family="sans-serif" font-size="12" text-anchor="middle">Submit</text>
  ${after ? `<circle cx="250" cy="137" r="14" fill="#238636"/><path d="M243 137 l5 5 l9 -11" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
  ${after ? `<rect x="24" y="100" width="180" height="10" rx="5" fill="#1f6feb" opacity="0.35"/>` : ''}
</svg>`.trim()
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function shots(title, hue) {
  return { before: svgShot({ title, hue, after: false }), after: svgShot({ title, hue, after: true }) }
}

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

// @@@ tidy-tree layout - post-order: leaves take the next column, parents center over their kids.
// Gives an organized top-down tree instead of hand-placed coordinates.
const X_GAP = 240, Y_GAP = 200
function layout(nodes) {
  const kids = {}
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n.id) })
  const pos = {}
  let col = 0
  const place = (id, depth) => {
    const cs = kids[id] || []
    let x
    if (cs.length === 0) { x = col * X_GAP; col++ }
    else { const xs = cs.map((c) => place(c, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2 }
    pos[id] = { x, y: depth * Y_GAP }
    return x
  }
  nodes.filter((n) => !n.parent).forEach((r) => place(r.id, 0))
  return pos
}

// @@@ loadSpecs - the tree now comes from the backend (spec-cli reads .spec + git history).
// We only decorate it client-side with layout positions and placeholder yatsu screenshots.
export async function loadSpecs() {
  const res = await fetch('/api/specs')
  const nodes = await res.json()
  const pos = layout(nodes)
  return nodes.map((n) => ({ ...n, ...pos[n.id], shots: shots(n.title, n.hue) }))
}

export const SESSION_LOG = log
