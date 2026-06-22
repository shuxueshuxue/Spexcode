// @@@ mock backend - what's left here is the client-side view decoration + a stand-in session log.
// - spec tree   -> reading .spec on `main` (the source of truth, via /api/specs)
// - session     -> the worktree linker (`git worktree list` + .session file + `tmux capture-pane`)

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
    `\x1b[90m  children: source-of-truth · dashboard-ui\x1b[0m`,
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

// @@@ tidy-tree layout, drill-down - left->right: depth sets the column (x), post-order stacks the
// VISIBLE leaves into rows (y), parents centre vertically over their kids. Root at the left, subtrees
// extend right. This is NOT a fixed full-forest map: `expanded` is the set of nodes whose children are
// shown — everything else collapses to a single tile, so a node's children appear only when it (and its
// whole ancestor spine) is expanded. A collapsed node is itself a leaf in the plot. The caller expands
// only the focused node's ancestor spine, which keeps the root layer a short, readable column however
// deep/bushy the real tree is (the y-extent of a point-per-leaf tree is otherwise = total leaf count).
// Gaps track the node box: a node is TWO rows (title + editor/last-edited line) and a touch wider for
// longer titles, so X_GAP/Y_GAP keep rows from touching.
export const X_GAP = 280, Y_GAP = 54
export function layout(nodes, expanded) {
  const kids = {}
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n.id) })
  const pos = {}
  let row = 0
  const place = (id, depth) => {
    const cs = expanded.has(id) ? (kids[id] || []) : []
    let y
    if (cs.length === 0) { y = row * Y_GAP; row++ }
    else { const ys = cs.map((c) => place(c, depth + 1)); y = (ys[0] + ys[ys.length - 1]) / 2 }
    pos[id] = { x: depth * X_GAP, y }
    return y
  }
  nodes.filter((n) => !n.parent).forEach((r) => place(r.id, 0))
  return pos
}

// @@@ apiFetch - ride through a zero-downtime backend reload. The supervisor (spec-cli) flips port 8787
// to a freshly health-checked child on a code change; a request landing in that sub-second window can
// still hit a refused/reset connection. A thrown fetch error is a TRANSIENT network failure (connection
// refused/reset) — retry it with bounded backoff (5 attempts over ~2s) so a reload is invisible. An
// actual HTTP response (even 4xx/5xx) is NOT transient: return it, don't retry. Exhausting the backoff
// rethrows the real error loudly rather than masking a genuinely-down backend.
const BACKOFF = [150, 350, 600, 900]   // waits between 5 attempts (~2.0s total)
export async function apiFetch(input, init) {
  for (let i = 0; ; i++) {
    try { return await fetch(input, init) }
    catch (e) {
      if (i >= BACKOFF.length) throw e
      await new Promise((r) => setTimeout(r, BACKOFF[i]))
    }
  }
}

// @@@ loadBoard - THIN wrapper. The board (merged tree + overlay + ghosts + sessions) is assembled by
// the backend `buildBoard()` and served at /api/board — the SAME data `spex board` prints, so human and
// agent share one source of truth. Returns the RAW nodes: the x/y tidy-tree layout is a pure view
// concern that now depends on which node is focused (drill-down expand-on-focus), so it lives in the
// view component (see App.jsx), not here. All overlay/ghost/session logic is server-side.
export async function loadBoard() {
  const res = await apiFetch('/api/board')
  return res.json()
}

// @@@ projectTitle - the self-identifying NAME of the project a backend serves: its spexcode.json
// dashboard.title override, else its launch-folder basename (resolved backend-side, arriving as
// board.project). The ONE source for that name, so the browser tab and the session-board list header
// read the same identity rather than each re-deriving it.
export const projectTitle = (board) => board?.project || ''

// @@@ loadConfig - the reflexive, skill-shaped slash presets (config nodes carrying `surface: slash`) the
// backend serves at /api/config: [{ name, title, desc, kind, dir, files, body }]. The new-session box lists these under its
// `/` palette and composes the picked preset's `body` (its {{targets}} filled by @-resolved nodes) into the
// launch prompt. Rides the same zero-downtime backoff as the board fetch.
export async function loadConfig() {
  const res = await apiFetch('/api/config')
  return res.json()
}

export const SESSION_LOG = log
