import { createDeadman } from './heartbeat.js'
import { apiUrl } from './project.js'

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
// invisible; an actual HTTP response (even 4xx/5xx) is returned, never retried. Every `/api` path is
// scoped through apiUrl ([[dashboard-shell]]'s project-scope seam, project.js), so callers keep writing
// plain '/api/...' whether the page is the root dashboard or a /p/<id>/ scoped one.
const BACKOFF = [150, 350, 600, 900]   // waits between 5 attempts (~2.0s total)
export async function apiFetch(input, init) {
  const url = typeof input === 'string' ? apiUrl(input) : input
  for (let i = 0; ; i++) {
    try { return await fetch(url, init) }
    catch (e) {
      if (i >= BACKOFF.length) throw e
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

// the ONE way to build a `/api/specs/:id/*` URL ([[id-url-safe]]): the node id is the sole variable path
// segment, so it is the sole thing encoded — every id-resolve fetch routes through here instead of
// hand-interpolating the id, so no call site can reintroduce a broken URL for an id with an awkward char.
// `parts` are trailing path segments (fixed route words like 'content'/'history', or an already-safe git
// hash) appended verbatim. Ids never contain '/' by construction, but encoding stays the invariant.
export const specUrl = (id, ...parts) =>
  apiUrl(`/api/specs/${encodeURIComponent(id)}${parts.map((p) => '/' + p).join('')}`)

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

// the session record detail (full originating prompt on top of the board row) behind /api/sessions/:id.
export async function loadSessionDetail(id) {
  const res = await apiFetch(sessionUrl(id))
  if (!res.ok) return null
  return res.json()
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
// to the trunk store, forge choices call the configured driver. An @-mention in the text dispatches a
// worker. Returns parsed json ({ ok, …, outcomes }); `outcomes` is the one-line @-dispatch summary to echo.
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
