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

// the ONE way to build a `/api/specs/:id/*` URL ([[id-url-safe]]): the node id is the sole variable path
// segment, so it is the sole thing encoded — every id-resolve fetch routes through here instead of
// hand-interpolating the id, so no call site can reintroduce a broken URL for an id with an awkward char.
// `parts` are trailing path segments (fixed route words like 'content'/'history', or an already-safe git
// hash) appended verbatim. Ids never contain '/' by construction, but encoding stays the invariant.
export const specUrl = (id, ...parts) =>
  `/api/specs/${encodeURIComponent(id)}${parts.map((p) => '/' + p).join('')}`

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

// the named launcher profiles ([[launcher-select]]) the backend serves at /api/launchers:
// `{ launchers: [{ name, harness }], default: '<name>' }` (never the host `cmd`) — `default` is the configured
// `defaultLauncher` so the New-Session dropdown pre-selects the SAME launcher a bare `spex new` uses. `launchers`
// is empty (and `default` '') when a project configured none → the form falls back to the plain harness picker.
export async function loadLaunchers() {
  const res = await apiFetch('/api/launchers')
  return res.json()
}

// the merged issues ([[issues]]) the backend serves at /api/issues: `{ enabled, issues }`, verbatim — the
// issues page renders what the CLI drain view reads, computing nothing over it (no re-sort, no salience order).
export async function loadIssues() {
  const res = await apiFetch('/api/issues')
  return res.json()
}

// human writes — LOCAL store only ([[issues-view]] / [[local-issues]]) — POST straight through the SAME
// open/reply the CLI uses (git-committed to the trunk, author 'human'); an @-mention in the text
// dispatches a worker. Both return the parsed json ({ ok, …, outcomes }); `outcomes` is the one-line
// @-dispatch summary to echo.
export async function postIssueReply(id, body, evidence) {
  const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, ...(evidence?.length ? { evidence } : {}) }),
  })
  return res.json()
}
export async function postIssueThread({ concern, nodes, body, evidence }) {
  const res = await apiFetch('/api/issues', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concern, nodes, body, ...(evidence?.length ? { evidence } : {}) }),
  })
  return res.json()
}
// author a REMARK on an eval's (node, scenario) thread ([[remark-substrate]] / [[event-detail]]) — the
// CLI-parity write the eval detail's composer uses (L: no dashboard-only path). The server find-or-creates
// the one thread for the pair and appends the remark; identity is server-derived ('human'), never sent. A
// scenario-scoped concern is a remark, never an issue (I1). Returns { ok, ref, rid, codeSha, outcomes }.
export async function postRemark({ node, scenario, issue, body, codeSha, evidence }) {
  const res = await apiFetch('/api/remarks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node, scenario, issue, body, ...(codeSha ? { codeSha } : {}), ...(evidence?.length ? { evidence } : {}) }),
  })
  return res.json()
}
// stash a captured video frame (PNG bytes) in the content-addressed blob store; returns { hash } — what an
// anchored annotation references (image link in its body, and the typed evidence[] on its thread).
export async function putFrameBlob(blob) {
  const res = await apiFetch('/api/yatsu/blob', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
  return res.json()
}

