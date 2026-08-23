import { createDeadman } from './heartbeat.js'
import { apiUrl } from './project.js'
import { PUBLIC_GRAPH_DOCUMENT_SOURCE, PUBLIC_GRAPH_METADATA_SOURCE, PUBLIC_GRAPH_SOURCE } from './public-mode.js'

// drill-down tidy-tree layout ([[node-graph]]); `expanded` is the single-layer expansion frontier chosen by
// GraphView. Each depth is its own column: roots are evenly spaced around the origin, then the children of
// the spine node in the previous column are evenly spaced around that parent's y. A later column therefore
// never contributes row budget to an earlier one.
export const X_GAP = 280, Y_GAP = 54
export const GRAPH_MIN_ZOOM = 0.4, GRAPH_MAX_ZOOM = 1.6
export const GRAPH_TILE_SIZE = { width: 176, height: 50 }

// The reading anchor intentionally sits left of the geometric centre so the child column remains in view.
// Keep this as a token: tuning the reading balance must not change graph coordinates.
export const CAMERA_ANCHOR_RATIO = 0.43
// One tile plus a compact breathing room keeps the root in the requested 35–48% reading band on the
// measured desktop pane while still reading as a single left gutter.
export const CAMERA_GUTTER = GRAPH_TILE_SIZE.width + 44

/**
 * Return the viewport that frames a focus using the reading-pair anchor.
 * `visible` contains graph-space node centres; node dimensions are supplied separately because React Flow
 * measures them after mount while the layout is already stable.
 */
export function viewportForFocus({
  focus, parent = null, child = null, visible = [], width, height, zoom,
  minZoom = GRAPH_MIN_ZOOM, maxZoom = GRAPH_MAX_ZOOM,
  tileWidth = GRAPH_TILE_SIZE.width, tileHeight = GRAPH_TILE_SIZE.height,
  anchorRatio = CAMERA_ANCHOR_RATIO, gutter = CAMERA_GUTTER, fit = true,
}) {
  if (!focus || width <= 0 || height <= 0) return { x: 0, y: 0, zoom }

  const points = visible.length ? visible : [focus]
  const minX = Math.min(...points.map((node) => node.x - tileWidth / 2))
  const maxX = Math.max(...points.map((node) => node.x + tileWidth / 2))
  const minY = Math.min(...points.map((node) => node.y - tileHeight / 2))
  const maxY = Math.max(...points.map((node) => node.y + tileHeight / 2))
  const contentWidth = Math.max(1, maxX - minX)
  const contentHeight = Math.max(1, maxY - minY)

  // A complete neighbourhood gets the whole pane, with one column of breathing room at the left edge.
  const currentFits = Number.isFinite(zoom)
    && contentWidth * zoom <= width - gutter
    && contentHeight * zoom <= height
  const fitZoom = Math.min(maxZoom, (width - gutter) / contentWidth, height / contentHeight)
  if (fit && currentFits && fitZoom >= minZoom) {
    return {
      x: gutter - minX * fitZoom,
      y: (height - contentHeight * fitZoom) / 2 - minY * fitZoom,
      zoom: fitZoom,
    }
  }

  const pair = child || parent
  const anchorX = pair ? (focus.x + pair.x) / 2 : focus.x
  const anchorZoom = !currentFits && fitZoom >= minZoom ? fitZoom : zoom
  const desiredY = height / 2 - focus.y * anchorZoom
  const minPanY = -minY * anchorZoom
  const maxPanY = height - maxY * anchorZoom
  const y = minPanY <= maxPanY
    ? Math.min(maxPanY, Math.max(minPanY, desiredY))
    : minPanY
  return {
    x: width * anchorRatio - anchorX * anchorZoom,
    y,
    zoom: anchorZoom,
  }
}

export function layout(nodes, expanded) {
  const kids = {}
  nodes.forEach((n) => { if (n.parent) (kids[n.parent] ??= []).push(n.id) })
  const pos = {}
  const roots = nodes.filter((n) => !n.parent)
  const placeColumn = (ids, depth, centerY) => {
    const start = centerY - ((ids.length - 1) / 2) * Y_GAP
    ids.forEach((id, index) => { pos[id] = { x: depth * X_GAP, y: start + index * Y_GAP } })
  }

  if (!roots.length) return pos
  placeColumn(roots.map((root) => root.id), 0, 0)

  // The normal frontier has one expanded spine node per depth. Keeping the column walk explicit makes
  // the single-layer contract visible: only that node's direct children enter the next column.
  let spine = roots.find((root) => expanded.has(root.id))?.id
  let depth = 1
  while (spine) {
    const children = expanded.has(spine) ? (kids[spine] || []) : []
    if (!children.length) break
    placeColumn(children, depth, pos[spine].y)
    spine = children.find((id) => expanded.has(id))
    depth += 1
  }
  return pos
}

// The graph's single-layer frontier: every ancestor needed to reach focus, plus focus itself.
export function singleLayerFrontier(nodes, focusId) {
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]))
  const focus = byId[focusId] || nodes.find((node) => !node.parent) || nodes[0]
  const expanded = new Set()
  for (let node = focus; node; node = node.parent ? byId[node.parent] : null) expanded.add(node.id)
  return expanded
}

// retry a thrown (transient: refused/reset) fetch with bounded backoff so a zero-downtime backend reload is
// invisible; an actual HTTP response (even 4xx/5xx) is returned, never retried. Every `/api` path is
// scoped through apiUrl ([[dashboard-shell]]'s project-scope seam, project.js), so callers keep writing
// plain '/api/...' whether the page is the root dashboard or a /p/<id>/ scoped one.
const BACKOFF = [150, 350, 600, 900]   // waits between 5 attempts (~2.0s total)
const UNREACHABLE_STATUS = new Set([502, 503, 504])
const backendHealthListeners = new Set()
let backendHealth = { offline: false, retryKey: 0 }

function publishBackendHealth(offline) {
  if (backendHealth.offline === offline) return
  backendHealth = { ...backendHealth, offline }
  backendHealthListeners.forEach((listener) => listener())
}

export function getBackendHealth() { return backendHealth }
export function subscribeBackendHealth(listener) {
  backendHealthListeners.add(listener)
  return () => backendHealthListeners.delete(listener)
}
export function retryBackend() {
  backendHealth = { ...backendHealth, retryKey: backendHealth.retryKey + 1 }
  backendHealthListeners.forEach((listener) => listener())
}

export async function apiFetch(input, init) {
  const url = typeof input === 'string' ? apiUrl(input) : input
  for (let i = 0; ; i++) {
    try {
      const response = await fetch(url, init)
      publishBackendHealth(UNREACHABLE_STATUS.has(response.status))
      return response
    }
    catch (e) {
      if (i >= BACKOFF.length) {
        publishBackendHealth(true)
        throw e
      }
      await new Promise((r) => setTimeout(r, BACKOFF[i]))
    }
  }
}

// conditional graph fetch ([[dashboard-shell]]): remember the last ETag and send If-None-Match, so the
// always-on fallback poll costs headers only while nothing changed — the server answers a bodyless 304 and
// we return null ("unchanged", the caller skips its repaint). cache:'no-store' keeps the browser HTTP cache
// out of the loop, so the 304 reaches US instead of being swallowed into a cache-served 200 that would
// repaint an identical board every tick.
//
// The conditional key MUST be the identity of the board the app actually DISPLAYS, or the poll goes blind
// (issue #70): a response superseded by a pushed board never paints, so if its ETag latched anyway, every
// later poll 304s against a board nobody is seeing while the display stays stale — a blackhole only a hard
// refresh exits. So the tag is returned to the caller and latches only when the caller APPLIES the body
// (`seal`), and a pushed board clears it (its identity is a delta-chain tag the HTTP lane can't express, so
// the next poll goes unconditional once, re-earning its 304s from a painted response).
let boardTag = ''
const clearBoardTag = () => { boardTag = '' }   // a pushed board took the display — see subscribeBoardLive
export async function loadGraph() {
  const res = await apiFetch('/api/graph', { cache: 'no-store', headers: boardTag ? { 'If-None-Match': boardTag } : {} })
  if (res.status === 304) return null
  // a gated scope ([[public-mode]]'s project/admin cookie) answers 401/403 with a JSON reason — surface
  // it as data so the shell can raise the credential gate instead of the generic load-error panel.
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => null)
    return { authRequired: body?.reason || 'project-login' }
  }
  const tag = res.headers.get('etag') || ''
  const board = await res.json()
  return { board, seal: () => { boardTag = tag } }
}

// The public Spec Graph is a sealed static artifact, not a narrowed live board. Keep it off apiUrl() and
// avoid every session/review transport: a static host need only serve this one JSON document and Vite assets.
// `no-cache` asks the browser to revalidate through the host's ETag; it avoids a stale symlink release without
// paying the full graph/document body again when the revision is unchanged.
export async function loadPublicGraph() {
  const response = await fetch(PUBLIC_GRAPH_SOURCE, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`public graph unavailable: ${response.status}`)
  const graph = await response.json()
  if (graph?.schema !== 'spexcode.public-spec-graph/v1' || !Array.isArray(graph?.nodes) || !graph?.identity) {
    throw new Error('public graph payload is invalid')
  }
  return { ...graph, sessions: [], issuesStamp: null }
}

export async function loadPublicGraphMetadata() {
  const response = await fetch(PUBLIC_GRAPH_METADATA_SOURCE, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`public graph metadata unavailable: ${response.status}`)
  const metadata = await response.json()
  const archive = metadata?.release?.archive
  // A repository url is OPTIONAL: a Flatcode flat's source may be a local path with no forge behind it, and
  // rejecting the whole release for a missing link would blank the panel over an absent nicety while the
  // graph, facts, and archive it exists to present are all there. The renderer omits the link instead.
  if (metadata?.schema !== 'spexcode.public-spec-site/v1'
    || !Array.isArray(metadata?.about?.facts)
    || !metadata?.release?.revision
    || !archive?.path
    || !archive?.name) {
    throw new Error('public graph metadata is invalid')
  }
  return metadata
}

export async function loadPublicSpecContent(id) {
  const source = `${PUBLIC_GRAPH_DOCUMENT_SOURCE}/${encodeURIComponent(id)}.json`
  const response = await fetch(source, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`public spec unavailable: ${response.status}`)
  const document = await response.json()
  if (document?.schema !== 'spexcode.public-spec-document/v1' || document.id !== id || typeof document.body !== 'string') {
    throw new Error('public spec payload is invalid')
  }
  return document
}

// the ONE way to build a `/api/specs/:id/*` URL ([[id-url-safe]]): the node id is the sole variable path
// segment, so it is the sole thing encoded — every id-resolve fetch routes through here instead of
// hand-interpolating the id, so no call site can reintroduce a broken URL for an id with an awkward char.
// `parts` are trailing path segments (fixed route words like 'content'/'history', or an already-safe git
// hash) appended verbatim. Ids never contain '/' by construction, but encoding stays the invariant.
export const specUrl = (id, ...parts) =>
  apiUrl(`/api/specs/${encodeURIComponent(id)}${parts.map((p) => '/' + p).join('')}`)

// what a node carries in its own folder besides its body and readings ([[node-attachments]]). A different
// gate from the source read — the spec tree sits outside the coverage policy on purpose — reached through
// the node's own id rather than a repo path, because the folder belongs to the node.
export async function fetchNodeFiles(id) {
  const res = await apiFetch(specUrl(id, 'files'))
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `attachment list failed (${res.status})`)
  return body?.files || []
}

export async function fetchNodeFileSlice(id, name, offset = 0, limit) {
  const q = new URLSearchParams({ name, offset: String(offset) })
  if (limit != null) q.set('limit', String(limit))
  const res = await apiFetch(`${specUrl(id, 'files', 'content')}?${q}`)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `attachment read failed (${res.status})`)
  return body
}

// one WINDOW of a governed source file ([[source-read]]). The board never asks for a whole file: it asks
// for a byte range and gets back `{size, offset, bytes, text, eof}`, so the next window starts at
// `offset + bytes` and the total `size` is known from the first response. A refusal (outside the worktree,
// or not a source file under the project's policy) arrives as `{error}` with a 400/404 — surfaced, never
// swallowed into an empty view that reads as "this file is blank".
export async function fetchSourceSlice(path, offset = 0, limit) {
  const q = new URLSearchParams({ path, offset: String(offset) })
  if (limit != null) q.set('limit', String(limit))
  const res = await apiFetch(`/api/source?${q}`)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `source read failed (${res.status})`)
  return body
}

// one LEVEL of a governed directory ([[source-list]]). The listing half of the same surface `fetchSourceSlice`
// reads from, and it pages the same way that one does — by asking again rather than by asking for everything:
// the tree fetches a level when the reader expands it, so a repository's size is never a cost the explorer
// pays up front. A refusal (an escape, a directory outside the governed roots) arrives as `{error}` with a
// 400/404 and is surfaced, never swallowed into an empty branch that reads as "this folder is empty".
export async function fetchDirEntries(dir = '') {
  const res = await apiFetch(`/api/files?${new URLSearchParams({ dir })}`)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `directory list failed (${res.status})`)
  return { entries: body?.entries || [], truncated: !!body?.truncated }
}

// subscribe to the graph's push channel in DELTA mode ([[graph-stream]]/[[graph-delta]]): the server sends a
// full snapshot on connect (`graph-full {to, graph}`), then hash-chained patches (`graph-delta {from, to,
// set, del}`) — a few KB per change instead of a full refetch. This is the client mirror of the server's
// unit decomposition: the board is held as a keyed map (node:<id> / sess:<id> / #order lists / meta), a
// patch applies only when its `from` tag matches ours (a mismatch reopens the stream, which re-anchors on a
// fresh graph-full — bounded, explicit recovery), and the rendered board is reconstructed from the map after
// every apply. An OLD backend ignores `?mode=delta` and emits bare `graph-changed` — that flips us to legacy
// mode: `onLegacyChange` fires and the caller refetches, exactly the pre-delta protocol. A silently dead
// EventSource (half-open tunnel, sleep-resume, frozen tab) delivers no data AND no error, so it can't be
// caught by an error handler — but it also stops delivering the server's `ping`, and THAT is detectable: a
// dead-man's switch (heartbeat.js — the shared client heartbeat contract) is re-armed by every stream event,
// so on a healthy link it never fires; DEAD_MS of silence lets it fire once, and the breach reopens the
// stream (re-anchoring on a fresh graph-full) and fires onLegacyChange so the caller's ETag refetch races
// the reconnect for immediacy. A frozen tab runs no timers, so its overdue one-shot fires on unfreeze and
// converges within ~a second of becoming visible — no visibilitychange hook needed. EventSource still
// auto-reconnects on a clean drop (a backend hot-reload); the dead-man only covers the silent-death case the
// browser can't see. The fallback poll stays as the final belt. Returns an unsubscribe.
export function subscribeBoardLive({ onBoard, onLegacyChange, onStatus }) {
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
  // the dead-man's switch: any stream event (data OR ping) re-arms it; on a healthy stream it never fires.
  // A breach presumes the stream dead — reopen (its board-full re-anchors and repaints), re-arm to keep
  // watching the replacement, and fire onLegacyChange so the caller's ETag refetch races the reconnect.
  const deadman = createDeadman(() => {
    if (!es || closed) return
    onStatus?.(false)
    reopen(); deadman.arm(); onLegacyChange?.()
  })
  const bump = () => deadman.arm()   // heartbeat: every event proves the stream still lives
  const open = () => {
    if (closed) return
    try { es = new EventSource(apiUrl('/api/graph/stream?mode=delta')) } catch { es = null; return }
    es.addEventListener('graph-full', (e) => {
      bump()
      const { to, graph } = JSON.parse(e.data)
      values = unitize(graph)
      tag = to
      clearBoardTag()   // the display's identity is now this frame's tag — the HTTP lane must re-earn its 304s
      onBoard(graph, { authoritative: true, tag: to })
      onStatus?.(true)
    })
    es.addEventListener('graph-delta', (e) => {
      bump()
      const d = JSON.parse(e.data)
      if (!values || tag !== d.from) { reopen(); return }
      for (const k of d.del || []) values.delete(k)
      for (const [k, v] of Object.entries(d.set || {})) values.set(k, v)
      tag = d.to
      clearBoardTag()
      onBoard(boardFrom(values), { authoritative: false, tag: d.to })
      onStatus?.(true)
    })
    es.addEventListener('graph-changed', () => { bump(); onLegacyChange?.() })
    es.addEventListener('error', () => onStatus?.(false))
    es.addEventListener('ping', bump)     // keep-alive, carries no board — only proves liveness
    es.addEventListener('ready', bump)    // stream-open ack — likewise a pure liveness beat
  }
  open()
  onStatus?.(false)
  bump()   // arm from the subscribe instant, so a stream that never comes up at all still breaches
  return () => { closed = true; deadman.disarm(); try { es?.close() } catch { /* already closed */ } }
}

// Session eval generations are ordered inside one backend epoch. A full graph may authoritatively rebase
// the epoch after a backend restart; a delta or same-epoch full may only advance. Rejected rows retain the
// last accepted projection, so a malformed/late board can never roll the toolbar backward.
export function acceptSessionEvalBoard(board, seen, authoritative = false) {
  if (!board?.sessions) return board
  const live = new Set(board.sessions.map((session) => session.id))
  if (authoritative) for (const id of seen.keys()) if (!live.has(id)) seen.delete(id)
  let changed = false
  const sessions = board.sessions.map((session) => {
    const projection = session.evalSummary
    if (!projection || !Number.isInteger(projection.generation) || !projection.epoch) return session
    const prior = seen.get(session.id)
    const newEpoch = prior && prior.epoch !== projection.epoch
    const accept = !prior
      || (newEpoch ? authoritative : projection.generation >= prior.generation)
    if (accept) {
      // A restarted backend may authoritatively rebase to a cold `loading` generation. The old epoch can
      // never remain current, but its stable value is still useful as explicit last-known until this epoch
      // publishes ready. This prevents a reconnect/remount from flashing 0/0 without weakening the rebase.
      const oldStable = prior?.projection?.phase === 'ready' && prior.projection.value
        ? { generation: prior.projection.generation, revision: prior.projection.revision, value: prior.projection.value }
        : prior?.projection?.lastKnown
      const accepted = newEpoch && !projection.value && !projection.lastKnown && oldStable
        ? { ...projection, lastKnown: oldStable }
        : projection
      seen.set(session.id, { epoch: accepted.epoch, generation: accepted.generation, projection: accepted })
      if (accepted !== projection) {
        changed = true
        return { ...session, evalSummary: accepted }
      }
      return session
    }
    changed = true
    return { ...session, evalSummary: prior.projection }
  })
  return changed ? { ...board, sessions } : board
}

// The backend carries one resolved identity object. Legacy fields remain read-only compatibility for a
// rolling frontend/backend deploy; every current consumer receives the one {title, icon} projection.
export const projectIdentity = (board) => ({
  title: board?.identity?.title || board?.project || '',
  icon: board?.identity?.icon || board?.projectIcon || 'spexcode',
})
export const projectTitle = (board) => projectIdentity(board).title

// the ONE way to build a `/api/sessions/:id/*` URL — the session-side twin of specUrl, same invariant:
// the id is the sole encoded segment, fixed route words append verbatim.
export const sessionUrl = (id, ...parts) =>
  apiUrl(`/api/sessions/${encodeURIComponent(id)}${parts.map((p) => '/' + p).join('')}`)

// a session's persisted interaction history ([[session-timeline]]): authored status transitions (full note
// text) + delivered prompts, oldest first — what the terminal-free face renders as the conversation.
// null on 404/failure (the caller keeps its last-known list; the poll retries).
export async function loadSessionTimeline(id) {
  const res = await apiFetch(sessionUrl(id, 'timeline'), { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

// A status row is the durable index; its explicit interval addresses the native payload lazily.
export async function loadSessionTranscript(id, from, to) {
  const query = new URLSearchParams({ from: String(from), to: String(to) })
  const res = await apiFetch(`${sessionUrl(id, 'transcript')}?${query}`, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` }
  return { ok: true, data: body }
}

// The execution stream is already normalized by the harness adapter. This client only decodes its compact
// JSON projection; it never receives a transcript path or parses native tool envelopes.
export function subscribeSessionExecution(id, onExecution) {
  let es = null
  let closed = false
  const reopen = () => { try { es?.close() } catch { /* an already-closed EventSource is harmless */ } ; open() }
  const deadman = createDeadman(() => {
    if (closed) return
    reopen()
    deadman.arm()
  })
  const receive = (event) => {
    deadman.arm()
    try { onExecution(JSON.parse(event.data)) } catch { /* a bad frame is skipped; the next revision replaces it */ }
  }
  const open = () => {
    if (closed) return
    try { es = new EventSource(sessionUrl(id, 'execution', 'stream')) } catch { es = null; return }
    es.addEventListener('execution', receive)
    es.addEventListener('ping', () => deadman.arm())
  }
  open()
  deadman.arm()
  return () => { closed = true; deadman.disarm(); try { es?.close() } catch { /* already closed */ } }
}

// the session record detail (full originating prompt on top of the board row) behind /api/sessions/:id.
export async function loadSessionDetail(id) {
  const res = await apiFetch(sessionUrl(id))
  if (!res.ok) return null
  return res.json()
}

export async function loadSessionDiff(id, path, offset = 0, limit = 120000) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) })
  if (path) query.set('path', path)
  const res = await apiFetch(`${sessionUrl(id, 'diff')}?${query}`, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: body?.error || `HTTP ${res.status}` }
  return { ok: true, data: body }
}

// dispatch a prompt to a session through the ONE input route every surface shares ([[dispatch]]).
// `replyVia:'note'` marks a terminal-free sender: the SERVER appends the note-reply insert
// ([[session-timeline]]), so the phrase lives in one place. Returns { ok, error? }.
export async function sendSessionText(id, text, { replyVia } = {}) {
  const res = await apiFetch(sessionUrl(id, 'input'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'text', text, ...(replyVia ? { replyVia } : {}) }),
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok && body?.ok !== false, error: body?.error }
}

// [[spec-body-edit]]: replace a line range of a node's spec body and land it as a commit. `original` is
// the text the reader saw — the server refuses rather than merges when it no longer matches, so the whole
// error body (message + code + the text that is actually there) is handed back for the editor to show.
export async function postSpecBody(id, patch) {
  const res = await apiFetch(specUrl(id, 'body'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(body?.error || `spec body edit failed (${res.status})`)
    error.code = body?.code || 'http-error'
    error.current = body?.current
    throw error
  }
  return body
}

// the command presets (plugin nodes with `surface: command`) the backend serves at /api/plugins.
export async function loadPlugins() {
  const res = await apiFetch('/api/plugins')
  return res.json()
}

// the review-track prose presets (plugin nodes with `surface: review`, [[review-commands]]) — the eval
// detail's remark-composer `/` palette; picking one prefills the composer, never a new write path.
export async function loadReviewPlugins() {
  const res = await apiFetch('/api/plugins?surface=review')
  return res.json()
}

// the resolved runtime settings the backend serves at /api/settings: `{ layout, launchers: [{ name, harness }],
// tmuxSocket, default: '<name>' }` (never the host `cmd`) — `default` is the configured `defaultLauncher` so the
// New-Session dropdown pre-selects the SAME launcher a bare `spex session new` uses ([[launcher-select]]). Built-in
// `claude`/`codex` profiles keep the picker present even when the project defines no extra launchers. `tmuxSocket`
// is the `-L` label the private tmux server runs under, so the attach modal ([[attach-menu]]) can compose the raw
// `tmux -L <socket> attach -t <id>` fallback without hardcoding the socket.
export async function loadSettings() {
  const res = await apiFetch('/api/settings')
  return res.json()
}

export async function loadIssue(id) {
  const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}`)
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// human writes — store-routed through the unified issue port ([[issues-view]] / [[issues]]) — local commits
// to the trunk store, forge choices call the configured driver. @session stays passive; @new creates only
// after the write commits. Returns parsed json ({ ok, …, outcomes }).
export async function postIssueReply(id, body, evidence) {
  const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}/reply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, ...(evidence?.length ? { evidence } : {}) }),
  })
  return res.json()
}
export async function postIssueClose(id) {
  const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}/close`, { method: 'POST' })
  return res.json()
}
// Promote is the one local lifecycle action besides close: it creates the real forge issue first, then
// closes out the local thread with the permalink trail.
export async function postIssuePromote(id) {
  const res = await apiFetch(`/api/issues/${encodeURIComponent(id)}/promote`, { method: 'POST' })
  return res.json()
}
// resolve/retract a remark by its `<thread-id>#<rid>` ref ([[remark-substrate]]) — the ref rides the BODY
// (a '#' in a URL is a fragment). Identity is server-derived ('human'): resolve is the human's second-party
// judgment on an agent's remark, retract withdraws the human's OWN unresolved one — the buttons only mirror
// who-may; the server enforces it.
export async function postRemarkAction(action, ref) {
  const res = await apiFetch(`/api/remarks/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref }),
  })
  return res.json()
}
export async function postIssueThread({ concern, body, evidence, store }) {
  const res = await apiFetch('/api/issues', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concern, body, store, ...(evidence?.length ? { evidence } : {}) }),
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
// the human sign-off on a scenario's latest reading ([[human-ok]]) — the CLI-parity write behind the ok
// affordance (feed row + detail header): the server binds the ok to the latest reading and derives the
// identity ('human') itself, never from this call. Returns { ok, already, humanOk } or { error }.
export async function postEvalOk(node, scenario) {
  const res = await apiFetch(`/api/specs/${encodeURIComponent(node)}/evals/ok`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }),
  })
  return res.json()
}
// stash a captured video frame (PNG bytes) in the content-addressed blob store; returns { hash } — what an
// anchored annotation references (image link in its body, and the typed evidence[] on its thread).
export async function putFrameBlob(blob) {
  const res = await apiFetch('/api/evidence', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
  return res.json()
}
