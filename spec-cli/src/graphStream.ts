import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { sessionsRoot, gitCommonDir } from './layout.js'
import { sessionSignature } from './sessions.js'
import { getBoard, invalidateBoard } from './graphCache.js'
import { unitize, tagOf, diffUnits, type Units } from './graphDelta.js'

// @@@ board-stream — the board's freshness is PUSHED, not polled. A dashboard subscribes here ONCE; in
// plain mode it gets a bare `graph-changed` and refetches /api/graph (the legacy protocol, kept verbatim
// for old clients); in DELTA mode (`?mode=delta`) the server itself rebuilds on change and streams the
// hash-chained patch ([[graph-delta]]): a `graph-full {to, graph}` on connect, then `graph-delta
// {from, to, set, del}` per change — a few KB against the ~600KB snapshot, with a full-snapshot send
// whenever the patch wouldn't win (bigger than the board, or the unit decomposition's id-uniqueness
// precondition failed), so a delta subscriber is NEVER worse off than a full refetch.
//
// Event sources, ALL funneled into one debounced pipeline: (1) fs.watch on the per-user session store —
// every lifecycle transition lands as a sessions/<id>/session.json write; (2) fs.watch on the shared git
// dir's refs (+ packed-refs/HEAD) — a commit or merge moves a ref, so tree reshapes push instead of
// waiting out a poll; (3) a subscriber-gated ~2s poll of the CHEAP tmux session signature ([[sessions]])
// for liveness/activity, which never touch a file; (4) a delta-gated ~15s cold tick that rebuilds and
// diffs server-side, catching what no watcher sees (uncommitted worktree spec edits, forge issues) — ONE
// rebuild per tick total, replacing every open dashboard's own 15s full refetch. Plain mode without delta
// subscribers keeps its zero-build behavior: sources just fan out `graph-changed`.

type Notify = () => void
type Frame = { event: string; data: string }
type DeltaSend = (frame: Frame) => void
const plainSubs = new Set<Notify>()
const deltaSubs = new Set<DeltaSend>()
let debounce: ReturnType<typeof setTimeout> | null = null

// ---- the rebuild→diff→broadcast pipeline (runs only while delta subscribers exist) ----
// last successfully-broadcast snapshot: the delta chain's anchor. `lastFullFrame` is what a fresh
// subscriber gets instantly; `lastUnits`+`lastTag` are what the next diff chains from. A snapshot that
// failed the unitize precondition anchors nothing (lastUnits=null) so every following send is a full.
let lastUnits: Units | null = null
let lastTag = ''
let lastFullFrame: Frame | null = null
let building = false
let dirty = false

async function rebuildAndBroadcast(): Promise<void> {
  if (building) { dirty = true; return }
  building = true
  try {
    do {
      dirty = false
      let board: unknown
      // share the route's single-flight build ([[graph-cache]]); fireChanged() already invalidated the
      // cache, so this gets a fresh build (or joins one a concurrent poll already started).
      try { board = await getBoard() } catch { for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }; continue }
      const boardJson = JSON.stringify(board)
      const { units, ok } = unitize(board as Record<string, unknown>)
      const tag = tagOf(units)
      if (tag === lastTag) continue
      const fullFrame: Frame = { event: 'graph-full', data: `{"to":"${tag}","graph":${boardJson}}` }
      let frame = fullFrame
      if (lastUnits && ok) {
        const { set, del } = diffUnits(lastUnits, units)
        const deltaData = JSON.stringify({ from: lastTag, to: tag, set, del })
        // guaranteed win: ship the patch only when it actually beats the snapshot
        if (deltaData.length < fullFrame.data.length) frame = { event: 'graph-delta', data: deltaData }
      }
      lastUnits = ok ? units : null
      lastTag = tag
      lastFullFrame = fullFrame
      for (const send of [...deltaSubs]) { try { send(frame) } catch { /* swept on abort */ } }
      for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }
    } while (dirty)
  } finally { building = false }
}

// a merge/launch/close touches several record files at once; collapse the burst into ONE signal. With
// delta subscribers the debounced fire rebuilds and broadcasts (plain subs then ride the same tag-moved
// gate — no spurious refetches); without them it stays the zero-build legacy notify.
function fireChanged(): void {
  // invalidate the route's board cache ([[graph-cache]]) on EVERY change signal, before the debounce guard
  // — a plain-mode client that polls /api/graph (no delta rebuild here) must still see fresh data on its
  // next poll, and a delta rebuild below re-reads the same now-stale cache.
  invalidateBoard()
  if (debounce) return
  debounce = setTimeout(() => {
    debounce = null
    if (deltaSubs.size) void rebuildAndBroadcast()
    else for (const notify of [...plainSubs]) { try { notify() } catch { /* swept on abort */ } }
  }, 150)
}

// ---- event source 0: an EXPLICIT server-side nudge ----
// for a server-side mutation that must show instantly regardless of watcher health: /rename writes the
// session's global record (`session.json` — [[session-rename]]), which lives INSIDE the watched store, so
// source 1 normally sees the write too. The explicit route call stays because that fs watch is best-effort
// (it can fail to attach), and the nudge makes the sub-second rename guarantee deterministic. Same
// debounced funnel as every other source.
export const notifyBoardChanged = (): void => fireChanged()

// ---- event source 1: the session store (lifecycle status writes) ----
let watcher: FSWatcher | null = null
function ensureWatcher(): void {
  if (watcher) return
  const root = sessionsRoot()
  try { mkdirSync(root, { recursive: true }) } catch { /* best-effort; the watch below still tries */ }
  try { watcher = watch(root, { recursive: true }, () => fireChanged()) } catch { watcher = null }
}

// ---- event source 2: git refs (a commit/merge reshapes the tree the moment the ref moves) ----
// refs/ recursively for loose refs (heads, worktree branches), plus the common dir itself non-recursively
// for packed-refs rewrites and HEAD flips. Best-effort like every source: no watch → the cold tick covers.
let refsWatchers: FSWatcher[] | null = null
function ensureRefsWatcher(): void {
  if (refsWatchers) return
  refsWatchers = []
  try {
    const common = gitCommonDir()
    try { refsWatchers.push(watch(join(common, 'refs'), { recursive: true }, () => fireChanged())) } catch { /* loose refs unwatched */ }
    try { refsWatchers.push(watch(common, (_e, f) => { if (f === 'packed-refs' || f === 'HEAD') fireChanged() })) } catch { /* packed refs unwatched */ }
  } catch { /* not a repo? the cold tick still covers */ }
}

// ---- event source 3: the tmux-derived signature (liveness + activity — never a file write) ----
let poller: ReturnType<typeof setInterval> | null = null
let lastSig = ''
function ensureLivePoll(): void {
  if (poller) return
  poller = setInterval(() => {
    void sessionSignature().then((sig) => { if (sig !== lastSig) { lastSig = sig; fireChanged() } }).catch(() => {})
  }, 2000)
}

// ---- event source 4: the cold tick — the server-side replacement for every client's slow fallback poll.
// Rebuild+diff on a relaxed timer so what NO watcher sees (an uncommitted worktree spec edit, a forge
// issue refresh) still lands; an unchanged tag broadcasts nothing. Delta-gated: plain-only clients keep
// their own client-side fallback, so without delta subscribers this must not burn builds.
let coldTick: ReturnType<typeof setInterval> | null = null
function ensureColdTick(): void {
  if (coldTick) return
  coldTick = setInterval(() => { if (deltaSubs.size) void rebuildAndBroadcast() }, 15000)
}

function stopSourcesIfIdle(): void {
  if (plainSubs.size + deltaSubs.size > 0) return
  if (poller) { clearInterval(poller); poller = null; lastSig = '' }
  if (coldTick) { clearInterval(coldTick); coldTick = null }
}

// GET /api/graph/stream — one SSE per dashboard tab, server→client only, with a periodic `ping` so an
// idle proxy never times the connection out. On a backend hot-reload the stream drops and EventSource
// auto-reconnects to the fresh child; a delta subscriber's reconnect lands a fresh `graph-full`, so the
// chain re-anchors with no client-side repair logic.
export function boardStream(c: Context) {
  const delta = c.req.query('mode') === 'delta'
  ensureWatcher()
  ensureRefsWatcher()
  return streamSSE(c, async (stream) => {
    let aborted = false
    const send: DeltaSend = (frame) => { void stream.writeSSE(frame).catch(() => {}) }
    const notify: Notify = () => { void stream.writeSSE({ event: 'graph-changed', data: 'x' }).catch(() => {}) }
    if (delta) { deltaSubs.add(send); ensureColdTick() } else { plainSubs.add(notify) }
    ensureLivePoll()
    const unsub = (): void => { deltaSubs.delete(send); plainSubs.delete(notify); stopSourcesIfIdle() }
    stream.onAbort(() => { aborted = true; unsub() })
    try {
      await stream.writeSSE({ event: 'ready', data: 'x' })
      if (delta) {
        // seed the chain: the cached anchor snapshot immediately (same tag the next delta chains from),
        // then a fire so a connect during a quiet stretch converges to truly-current within one build.
        if (lastFullFrame) { await stream.writeSSE(lastFullFrame).catch(() => {}) ; fireChanged() }
        else void rebuildAndBroadcast()
      }
      while (!aborted) {
        await stream.sleep(25000)
        if (aborted) break
        await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } finally { unsub() }
  })
}
