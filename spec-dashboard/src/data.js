// LOGS: stand-in mock tmux scrollback for the demo board (the real session log comes from the backend).
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

// drill-down tidy-tree layout ([[node-graph]]); `expanded` is the focused node's ancestor spine.
export const X_GAP = 280, Y_GAP = 54
export function layout(nodes, expanded) {
  const kids = {}
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n.id) })
  const pos = {}
  const place = (id, depth, y) => {
    pos[id] = { x: depth * X_GAP, y }
    const cs = expanded.has(id) ? (kids[id] || []) : []
    if (!cs.length) return
    const top = y - ((cs.length - 1) / 2) * Y_GAP   // children block centred on the parent's row
    cs.forEach((c, i) => place(c, depth + 1, top + i * Y_GAP))
  }
  nodes.filter((n) => !n.parent).forEach((r, i) => place(r.id, 0, i * Y_GAP))
  return pos
}

// retry a thrown (transient: refused/reset) fetch with bounded backoff so a zero-downtime backend reload is
// invisible; an actual HTTP response (even 4xx/5xx) is returned, never retried.
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

export async function loadBoard() {
  const res = await apiFetch('/api/board')
  return res.json()
}

// subscribe to the board's push channel in DELTA mode ([[board-stream]]/[[board-delta]]): the server sends a
// full snapshot on connect (`board-full {to, board}`), then hash-chained patches (`board-delta {from, to,
// set, del}`) — a few KB per change instead of a full refetch. This is the client mirror of the server's
// unit decomposition: the board is held as a keyed map (node:<id> / sess:<id> / #order lists / meta), a
// patch applies only when its `from` tag matches ours (a mismatch reopens the stream, which re-anchors on a
// fresh board-full — bounded, explicit recovery), and the rendered board is reconstructed from the map after
// every apply. An OLD backend ignores `?mode=delta` and emits bare `board-changed` — that flips us to legacy
// mode: `onLegacyChange` fires and the caller refetches, exactly the pre-delta protocol. `onLive` reports
// whether push is proven alive, so the caller's slow fallback poll can stand down instead of re-downloading
// the snapshot it already holds. EventSource auto-reconnects on drop (a backend hot-reload); every reconnect
// gets a fresh board-full, so a lost stream self-heals with no client repair logic. Returns an unsubscribe.
export function subscribeBoardLive({ onBoard, onLegacyChange, onLive }) {
  let es = null
  let closed = false
  let values = null   // unit-value map, the client's copy of the server's decomposition
  let tag = ''
  const unitize = (b) => {
    const { nodes = [], sessions = [], ...meta } = b
    const m = new Map([['meta', meta], ['nodes#order', nodes.map((n) => n.id)], ['sess#order', sessions.map((s) => s.id)]])
    nodes.forEach((n) => m.set('node:' + n.id, n))
    sessions.forEach((s) => m.set('sess:' + s.id, s))
    return m
  }
  const boardFrom = (m) => {
    const pick = (prefix, orderKey) => (m.get(orderKey) || []).map((id) => m.get(prefix + id))
    return { ...(m.get('meta') || {}), nodes: pick('node:', 'nodes#order'), sessions: pick('sess:', 'sess#order') }
  }
  const reopen = () => { try { es?.close() } catch { /* already closed */ } ; values = null; tag = ''; open() }
  const open = () => {
    if (closed) return
    try { es = new EventSource('/api/board/stream?mode=delta') } catch { es = null; onLive?.(false); return }
    es.addEventListener('board-full', (e) => {
      const { to, board } = JSON.parse(e.data)
      values = unitize(board)
      tag = to
      onLive?.(true)
      onBoard(board)
    })
    es.addEventListener('board-delta', (e) => {
      const d = JSON.parse(e.data)
      if (!values || tag !== d.from) { reopen(); return }
      for (const k of d.del || []) values.delete(k)
      for (const [k, v] of Object.entries(d.set || {})) values.set(k, v)
      tag = d.to
      onLive?.(true)
      onBoard(boardFrom(values))
    })
    es.addEventListener('board-changed', () => { onLive?.(false); onLegacyChange?.() })
    es.addEventListener('error', () => onLive?.(false))
  }
  open()
  return () => { closed = true; try { es?.close() } catch { /* already closed */ } }
}

// the project's self-identifying name ([[tab-title]]), resolved backend-side as board.project.
export const projectTitle = (board) => board?.project || ''

// @@@ favicon source ([[tab-icon]]) - the configured dashboard.icon rides the board as board.projectIcon.
// Three painless forms, NONE needing a downloaded/vendored asset: a full URL (used as-is), an Iconify
// name `set:name` → its CDN SVG (api.iconify.design, 200k+ icons), or anything else treated as an emoji/
// glyph rendered into an inline SVG data-URI (zero network). Empty → '' so the html default stands.
export const projectIcon = (board) => board?.projectIcon || ''
export function faviconHref(icon) {
  if (!icon) return ''
  if (/^https?:\/\//.test(icon)) return icon
  if (/^[a-z0-9-]+[:/][a-z0-9-]+$/i.test(icon)) return `https://api.iconify.design/${icon.replace(':', '/')}.svg`
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`)
}

// the command presets (config nodes with `surface: command`) the backend serves at /api/config.
export async function loadConfig() {
  const res = await apiFetch('/api/config')
  return res.json()
}

// the forum (proposals + notes) the backend serves at /api/forum: `{ enabled, threads }`, verbatim — the
// info page renders what the CLI drain view reads, computing nothing over it (no re-sort, no salience order).
export async function loadForum() {
  const res = await apiFetch('/api/forum')
  return res.json()
}

// human writes to the forum ([[forum-view]] / [[proposals]]) — POST straight through the SAME reply/propose
// the CLI uses (git-committed to the trunk, author 'human'); an @-mention in the text dispatches a worker.
// Both return the parsed json ({ ok, …, outcomes }); `outcomes` is the one-line @-dispatch summary to echo.
export async function postForumReply(id, body) {
  const res = await apiFetch(`/api/forum/${encodeURIComponent(id)}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  })
  return res.json()
}
export async function postForumThread({ concern, kind, nodes, body }) {
  const res = await apiFetch('/api/forum', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concern, kind, nodes, body }),
  })
  return res.json()
}

export const SESSION_LOG = log
