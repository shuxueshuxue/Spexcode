import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, readdirSync, readFileSync, type FSWatcher } from 'node:fs'
import { join, dirname } from 'node:path'
import { sessionsRoot, gitCommonDir } from './layout.js'
import { hotSignature, warmSignature } from './sessions.js'
import { getBoard, invalidateBoard } from './graphCache.js'
import { unitize, tagOf, diffUnits, type Units } from './graphDelta.js'
import {
  holdSessionEvalProjectionObserver,
  invalidateSessionEvalProjections,
  releaseSessionEvalProjectionObserver,
  setSessionEvalProjectionNotify,
} from '../../spec-eval/src/sessioneval.js'

// @@@ board-stream — the board's freshness is PUSHED, not polled. A dashboard subscribes here ONCE; in
// plain mode it gets a bare `graph-changed` and refetches /api/graph (the legacy protocol, kept verbatim
// for old clients); in DELTA mode (`?mode=delta`) the server itself rebuilds on change and streams the
// hash-chained patch ([[graph-delta]]): a `graph-full {to, graph}` on connect, then `graph-delta
// {from, to, set, del}` per change — a few KB against the ~600KB snapshot, with a full-snapshot send
// whenever the patch wouldn't win (bigger than the board, or the unit decomposition's id-uniqueness
// precondition failed), so a delta subscriber is NEVER worse off than a full refetch.
//
// Every source carries the DOMAIN of the change it saw — 'sessions' (only the session rows moved) or 'full'
// (anything could have) — and fireChanged funnels them into ONE debounced pipeline, escalating to the max
// scope seen in the window so the cache can splice sessions instead of rebuilding whole ([[graph-cache]]).
// Sources: (1) fs.watch on the per-user session store — every lifecycle transition lands as a
// sessions/<id>/session.json write → 'sessions'; (2) fs.watch on the shared git dir's refs (+
// packed-refs/HEAD) — a commit/merge moves a ref, reshaping the tree → 'full'; (3) fs.watch on the git
// worktree REGISTRY (+ each live worktree root and gitdir index) — dirty source/spec/sidecar/rename/stage → 'full';
// (4) two subscriber-gated pollers of the tmux-derived signatures ([[sessions]]) that never touch a file —
// a 100ms HOT syscall poll and a 1s WARM tmux poll, both → 'sessions'; (5) a delta-gated ~15s cold-tick
// PATROL that invalidates FULL, rebuilds and diffs — the self-heal authority that catches whatever every
// leaf watcher missed (and is loud when it has to: see the repair accounting below) → 'full'. Plain mode
// without delta subscribers keeps its zero-build behavior: sources just fan out `graph-changed`.

type Scope = 'sessions' | 'full'
type EvalTarget = 'all' | { id?: string; path?: string }
type Notify = () => void
type Frame = { event: string; data: string }
type DeltaSend = (frame: Frame) => void
const plainSubs = new Set<Notify>()
const deltaSubs = new Set<DeltaSend>()
let debounce: ReturnType<typeof setTimeout> | null = null
let pendingScope: Scope | null = null   // the MAX change scope accumulated across the current debounce window
const maxScope = (a: Scope | null, b: Scope): Scope => (a === 'full' || b === 'full' ? 'full' : 'sessions')

// under SPEXCODE_BOARD_DEBUG=1, every broadcast logs its changed unit keys + trigger tags + build ms.
const DEBUG = process.env.SPEXCODE_BOARD_DEBUG === '1'
// the set of trigger tags accrued SINCE THE LAST BROADCAST — each fireChanged adds its scope, the cold tick
// adds 'patrol'. Cleared on every broadcast. Its job: prove WHO caused a broadcast, so a change that only
// the patrol saw (tag set === {'patrol'}) is flagged as a repair — some leaf watcher was blind.
const triggerTags = new Set<string>()

// watchers a test can amputate to prove the patrol still heals the graph ([[graph-stream]]): a CSV of
// store,refs,worktrees makes the matching ensure* a no-op (with a one-time warning), so a change on that
// path reaches subscribers ONLY via the cold-tick patrol — the missing-watcher scenario, on demand.
const DISABLED = new Set((process.env.SPEXCODE_DISABLE_WATCHERS || '').split(',').map((s) => s.trim()).filter(Boolean))
const warnedDisabled = new Set<string>()
function isDisabled(name: string): boolean {
  if (!DISABLED.has(name)) return false
  if (!warnedDisabled.has(name)) { warnedDisabled.add(name); console.warn(`spec-cli: graph watcher '${name}' disabled via SPEXCODE_DISABLE_WATCHERS — the cold-tick patrol must cover it`) }
  return true
}

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
      // cache (at the accumulated scope), so this gets a fresh build/splice (or joins one a concurrent poll
      // already started).
      const t0 = Date.now()
      try { board = await getBoard() } catch { for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }; continue }
      const buildMs = Date.now() - t0
      const boardJson = JSON.stringify(board)
      const { units, ok } = unitize(board as Record<string, unknown>)
      const tag = tagOf(units)
      if (tag === lastTag) continue
      // the changed unit keys — computed against the prior anchor when we have one (a first paint has no
      // anchor, so no repair claim can be made against it).
      const changedKeys = lastUnits ? (() => { const { set, del } = diffUnits(lastUnits, units); return [...Object.keys(set), ...del] })() : []
      const fullFrame: Frame = { event: 'graph-full', data: `{"to":"${tag}","graph":${boardJson}}` }
      let frame = fullFrame
      if (lastUnits && ok) {
        const { set, del } = diffUnits(lastUnits, units)
        const deltaData = JSON.stringify({ from: lastTag, to: tag, set, del })
        // guaranteed win: ship the patch only when it actually beats the snapshot
        if (deltaData.length < fullFrame.data.length) frame = { event: 'graph-delta', data: deltaData }
      }
      // the anchor is only meaningful while a delta subscriber holds the chain live: with none left,
      // nothing rebuilds on change, so a cached anchor would silently age into a stale first frame for the
      // NEXT era's subscriber (issue #70). A build that completes after the last unsub caches nothing
      // (stopSourcesIfIdle cleared the anchor; leaving lastTag/lastUnits stale-cleared is consistent —
      // rebuilds only run while delta subscribers exist, so nothing chains from them meanwhile).
      if (deltaSubs.size) { lastUnits = ok ? units : null; lastTag = tag; lastFullFrame = fullFrame }
      for (const send of [...deltaSubs]) { try { send(frame) } catch { /* swept on abort */ } }
      for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }
      // ---- repair accounting: a real (tag-moved) broadcast whose ONLY trigger was the cold-tick patrol
      // means a leaf watcher was BLIND — the patrol self-healed it. That is a bug report, not routine, so
      // it is ALWAYS loud (repairs are supposed to be zero — [[graph-stream]]). Under DEBUG, every
      // broadcast logs its changed keys + triggers + build ms.
      const tags = [...triggerTags]
      if (changedKeys.length && tags.length === 1 && tags[0] === 'patrol')
        console.warn(`spec-cli: PATROL-REPAIR — the cold tick caught a change no leaf watcher pushed; changed units: [${changedKeys.join(', ')}] — a blind watcher, investigate`)
      if (DEBUG)
        console.warn(`spec-cli: graph broadcast — changed [${changedKeys.join(', ')}] triggers {${tags.join(', ')}} build ${buildMs}ms`)
      triggerTags.clear()
    } while (dirty)
  } finally { building = false }
}

// a merge/launch/close touches several record files at once; collapse the burst into ONE signal. Each call
// carries its change SCOPE; the window accumulates the MAX ([[graph-cache]] escalates none→sessions→full).
// With delta subscribers the debounced fire rebuilds and broadcasts (plain subs then ride the same
// tag-moved gate — no spurious refetches); without them it stays the zero-build legacy notify.
function fireChanged(scope: Scope = 'full', evalTarget?: EvalTarget): void {
  // Advance eval input generations BEFORE invalidating/building the board, so the first frame caused by an
  // input event is `updating(lastKnown)`. Summary completion calls this function without a target.
  if (evalTarget) invalidateSessionEvalProjections(evalTarget)
  pendingScope = maxScope(pendingScope, scope)
  // invalidate the route's board cache ([[graph-cache]]) on EVERY change signal, at the accumulated scope,
  // before the debounce guard — a plain-mode client that polls /api/graph (no delta rebuild here) must
  // still see fresh data on its next poll, and a delta rebuild below re-reads the same now-stale cache.
  invalidateBoard(pendingScope)
  triggerTags.add(scope)
  // DEBOUNCE = 25ms. Real fs-event bursts (a merge touching many records) were MEASURED to span 0–5ms, so a
  // 25ms window collapses them with room to spare while shaving ~125ms off the old 150ms lag; anything
  // wider than the window is coalesced anyway by the in-flight build's dirty-rerun loop, which is the real
  // burst absorber. So the debounce is a micro-collapse, not the coalescer.
  if (debounce) return
  debounce = setTimeout(() => {
    debounce = null
    pendingScope = null
    if (deltaSubs.size) void rebuildAndBroadcast()
    else for (const notify of [...plainSubs]) { try { notify() } catch { /* swept on abort */ } }
  }, 25)
}

// ---- event source 0: an EXPLICIT server-side nudge ----
// for a server-side mutation that must show instantly regardless of watcher health: /rename writes the
// session's global record (`session.json` — [[session-rename]]), which lives INSIDE the watched store, so
// source 1 normally sees the write too. The explicit route call stays because that fs watch is best-effort
// (it can fail to attach), and the nudge makes the sub-second rename guarantee deterministic. Same
// debounced funnel as every other source; defaults to 'full' but the rename route passes 'sessions'.
export const notifyBoardChanged = (scope: Scope = 'full'): void =>
  fireChanged(scope, scope === 'full' ? 'all' : undefined)

// Stable summary batches re-enter the SAME session-unit graph path; this is not a second transport.
setSessionEvalProjectionNotify(() => fireChanged('sessions'))

// ---- event source 1: the session store (lifecycle status writes) → 'sessions' ----
let watcher: FSWatcher | null = null
function ensureWatcher(): void {
  if (watcher) return
  if (isDisabled('store')) return
  const root = sessionsRoot()
  try { mkdirSync(root, { recursive: true }) } catch { /* best-effort; the watch below still tries */ }
  try { watcher = watch(root, { recursive: true }, () => fireChanged('sessions')) } catch { watcher = null }
}

// ---- event source 2: git refs (a commit/merge reshapes the tree the moment the ref moves) → 'full' ----
// refs/ recursively for loose refs (heads, worktree branches), plus the common dir itself non-recursively
// for packed-refs rewrites and HEAD flips. Ordinary graph units still have the patrol; eval projections are
// observer-held across a failure and only become current after a replacement watch authorizes a rescan.
let refsWatchers: FSWatcher[] | null = null
const REFS_OBSERVER = 'graph:refs'

export function watchSessionEvalRefs(
  common: string,
  onInput: () => void,
  onFailure: () => void,
): FSWatcher[] {
  const attached: FSWatcher[] = []
  let failed = false
  const close = () => {
    for (const watcher of attached) { try { watcher.close() } catch { /* already gone */ } }
  }
  const fail = () => {
    if (failed) return
    failed = true
    close()
    onFailure()
  }
  try {
    attached.push(watch(join(common, 'refs'), { recursive: true }, (_event, file) => {
      if (file == null) { fail(); return }
      onInput()
    }))
    attached.push(watch(common, (_event, file) => {
      if (file == null) { fail(); return }
      if (file === 'packed-refs' || file === 'HEAD') onInput()
    }))
    for (const watcher of attached) watcher.on('error', fail)
    return attached
  } catch (error) {
    close()
    throw error
  }
}

function refsWatcherFailed(): void {
  refsWatchers = null
  if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
  setImmediate(() => ensureRefsWatcher(false))
}

function ensureRefsWatcher(retry = true): void {
  if (refsWatchers) return
  if (isDisabled('refs')) {
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
    return
  }
  try {
    const common = gitCommonDir()
    refsWatchers = watchSessionEvalRefs(common, () => fireChanged('full', 'all'), refsWatcherFailed)
    if (releaseSessionEvalProjectionObserver(REFS_OBSERVER)) fireChanged('full')
  } catch {
    refsWatchers = null
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
    if (retry) setImmediate(() => ensureRefsWatcher(false))
  }
}

// ---- event source 3: worktree registry + working roots + per-worktree indexes → 'full' ----
// Summary inputs include ordinary dirty source and staged-only changes, not just `.spec`. Each registry row
// therefore owns a recursive working-root watcher plus a non-recursive watcher on git's worktree metadata
// dir (`index`). A delivered event advances that worktree's eval generation before the graph rebuild.
let registryWatcher: FSWatcher | null = null
type WorktreeWatch = { path: string; root: FSWatcher; index: FSWatcher }
const worktreeWatchers = new Map<string, WorktreeWatch>()
const worktreeRetryAttempted = new Set<string>()
const worktreeRetryCount = new Map<string, number>()
const worktreeObserver = (name: string): string => `graph:worktree:${name}`

export function scheduleWorktreeResubscribe(
  name: string,
  attempted: Set<string>,
  retry: () => void,
  delayMs = 0,
): boolean {
  if (attempted.has(name)) return false
  attempted.add(name)
  const timer = setTimeout(() => {
    attempted.delete(name)
    retry()
  }, delayMs)
  timer.unref?.()
  return true
}

function scheduleWorktreeRetry(name: string): boolean {
  if (worktreeRetryAttempted.has(name)) return false
  const attempt = (worktreeRetryCount.get(name) ?? 0) + 1
  worktreeRetryCount.set(name, attempt)
  const delayMs = Math.min(1_000, 25 * (2 ** Math.min(attempt - 1, 5)))
  return scheduleWorktreeResubscribe(name, worktreeRetryAttempted, reconcileWorktrees, delayMs)
}

const ignoredWorktreePath = (file: string): boolean =>
  file === '.git' || file.startsWith('.git/') || file === 'node_modules' || file.startsWith('node_modules/')

export function watchSessionEvalWorktree(
  wtPath: string,
  gitDir: string,
  onInput: () => void,
  onFailure: () => void,
): { root: FSWatcher; index: FSWatcher } {
  let failed = false
  let root: FSWatcher | null = null
  let index: FSWatcher | null = null
  const fail = () => {
    if (failed) return
    failed = true
    try { root?.close() } catch { /* already gone */ }
    try { index?.close() } catch { /* already gone */ }
    onFailure()
  }
  try {
    root = watch(wtPath, { recursive: true }, (_event, filename) => {
      if (filename == null) { fail(); return }
      const file = String(filename)
      if (!ignoredWorktreePath(file)) onInput()
    })
    index = watch(gitDir, (_event, filename) => {
      if (filename == null) { fail(); return }
      if (String(filename) === 'index') onInput()
    })
    root.on('error', fail)
    index.on('error', fail)
    return { root, index }
  } catch (error) {
    fail()
    throw error
  }
}

function dropWorktreeWatcher(name: string): WorktreeWatch | null {
  const row = worktreeWatchers.get(name)
  if (!row) return null
  worktreeWatchers.delete(name)
  try { row.root.close() } catch { /* already gone */ }
  try { row.index.close() } catch { /* already gone */ }
  return row
}

function watcherFailed(name: string, path: string): void {
  // Failure/overflow has no trustworthy path. Keep last-known, mark the target updating, and immediately
  // resubscribe; the authorized summary build is the one authoritative rescan, never a periodic sweep.
  dropWorktreeWatcher(name)
  if (holdSessionEvalProjectionObserver(worktreeObserver(name), { path })) fireChanged('full')
  scheduleWorktreeRetry(name)
}

function reconcileWorktrees(): void {
  let dir: string
  try { dir = join(gitCommonDir(), 'worktrees') } catch { return }
  let ents: import('node:fs').Dirent[] = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { /* no worktrees registry yet */ }
  const live = new Set<string>()
  let released = false
  for (const e of ents) {
    if (!e.isDirectory()) continue
    live.add(e.name)
    if (worktreeWatchers.has(e.name) || worktreeRetryAttempted.has(e.name)) continue
    try {
      // the entry's `gitdir` file points at the worktree's `<tree>/.git` (file or dir); its parent is the tree.
      const wtPath = dirname(readFileSync(join(dir, e.name, 'gitdir'), 'utf8').trim())
      const { root, index } = watchSessionEvalWorktree(
        wtPath,
        join(dir, e.name),
        () => fireChanged('full', { path: wtPath }),
        () => watcherFailed(e.name, wtPath),
      )
      const row = { path: wtPath, root, index }
      worktreeWatchers.set(e.name, row)
      worktreeRetryAttempted.delete(e.name)
      worktreeRetryCount.delete(e.name)
      // The replacement is live before its hold is removed. This delta authorizes one double-read rescan,
      // so edits made anywhere in the unwatched interval are inside the new generation's fingerprint.
      if (releaseSessionEvalProjectionObserver(worktreeObserver(e.name))) fireChanged('full')
    } catch {
      // An attach failure is observable: mark unknown/full now. The next registry change or explicit graph
      // source setup retries; no patrol is allowed to call the eval projection current.
      let path: string | null = null
      try { path = dirname(readFileSync(join(dir, e.name, 'gitdir'), 'utf8').trim()) } catch { /* broken row */ }
      if (holdSessionEvalProjectionObserver(worktreeObserver(e.name), path ? { path } : 'all')) fireChanged('full')
      scheduleWorktreeRetry(e.name)
    }
  }
  for (const name of worktreeWatchers.keys()) if (!live.has(name)) {
    dropWorktreeWatcher(name)
    released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
  }
  for (const name of worktreeRetryCount.keys()) if (!live.has(name)) {
    worktreeRetryAttempted.delete(name)
    worktreeRetryCount.delete(name)
    released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
  }
  if (released) fireChanged('full')
}
const WORKTREE_REGISTRY_OBSERVER = 'graph:worktree-registry'

export function watchSessionEvalRegistry(
  dir: string,
  onInput: () => void,
  onFailure: () => void,
): FSWatcher {
  let watcher: FSWatcher | null = null
  let failed = false
  const fail = () => {
    if (failed) return
    failed = true
    try { watcher?.close() } catch { /* already gone */ }
    onFailure()
  }
  try {
    watcher = watch(dir, (_event, file) => {
      if (file == null) { fail(); return }
      onInput()
    })
    watcher.on('error', fail)
    return watcher
  } catch (error) {
    try { watcher?.close() } catch { /* partial attach */ }
    throw error
  }
}

function registryWatcherFailed(): void {
  registryWatcher = null
  if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
  setImmediate(() => ensureWorktreeRegistry(false))
}

function ensureWorktreeRegistry(retry = true): void {
  if (registryWatcher) { reconcileWorktrees(); return }
  if (isDisabled('worktrees')) {
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
    return
  }
  try {
    const dir = join(gitCommonDir(), 'worktrees')
    try { mkdirSync(dir, { recursive: true }) } catch { /* best-effort */ }
    // a registry add/remove is itself a 'full' change (a new/gone worktree reshapes the overlay); also
    // reconcile the per-worktree `.spec` watchers on every registry event.
    registryWatcher = watchSessionEvalRegistry(dir, () => {
      reconcileWorktrees()
      fireChanged('full', 'all')
    }, registryWatcherFailed)
  } catch {
    registryWatcher = null
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
    if (retry) setImmediate(() => ensureWorktreeRegistry(false))
  }
  reconcileWorktrees()   // attach for the worktrees that already exist when the source starts
  if (registryWatcher && releaseSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER)) fireChanged('full')
}

// Attach the canonical filesystem sources before an HTTP snapshot starts summary work. This closes the
// request→SSE handoff gap: an edit after the snapshot build has a watcher before it can occur.
export function ensureBoardFileWatchers(): void {
  ensureWatcher()
  ensureRefsWatcher()
  ensureWorktreeRegistry()
}

// ---- event source 4: the two-tier tmux-derived pollers (liveness + activity — never a file write) → 'sessions' ----
// The signals a store watch can't see are tmux-derived, and they split by cost ([[sessions]]): a HOT 100ms
// poll of a cheap syscall-only fingerprint (a socket dying, a listener wedging) and a WARM 1s poll of the
// pane-title self-summaries (a headline change is a tmux round-trip, too dear at 100ms). Both fire 'sessions'.
let hotPoller: ReturnType<typeof setInterval> | null = null
let warmPoller: ReturnType<typeof setInterval> | null = null
let lastHot = ''
let lastWarm = ''
function ensurePollers(): void {
  if (!hotPoller) hotPoller = setInterval(() => {
    void hotSignature().then((sig) => { if (sig !== lastHot) { lastHot = sig; fireChanged('sessions') } }).catch(() => {})
  }, 100)
  if (!warmPoller) warmPoller = setInterval(() => {
    void warmSignature().then((sig) => { if (sig !== lastWarm) { lastWarm = sig; fireChanged('sessions') } }).catch(() => {})
  }, 1000)
}

// ---- event source 5: the cold-tick PATROL — the server-side replacement for every client's slow fallback
// poll, AND the self-heal authority. Rebuild+diff on a relaxed timer so what NO watcher saw (an uncommitted
// worktree spec edit a registry watch missed, a forge issue refresh) still lands. It INVALIDATES FULL first
// — otherwise getBoard() serves the stale cache and the patrol is a no-op (the real bug this fixes) — and
// tags the window 'patrol' so the repair accounting can flag a change only it caught. Delta-gated: plain-only
// clients keep their own client-side fallback, so without delta subscribers this must not burn builds.
let coldTick: ReturnType<typeof setInterval> | null = null
function ensureColdTick(): void {
  if (coldTick) return
  coldTick = setInterval(() => {
    if (!deltaSubs.size) return
    invalidateBoard('full')
    triggerTags.add('patrol')
    void rebuildAndBroadcast()
  }, 15000)
}

function stopSourcesIfIdle(): void {
  // the delta anchor dies with its era's last subscriber: past this point changes invalidate the cache but
  // never rebuild, so lastFullFrame would drift arbitrarily far from the real board — and the next era's
  // first subscriber would be anchored on it (its warm-terminal set then drops live sessions' panes, and the
  // client's recovery lanes can latch each other out — issue #70). A new era opens on a fresh build instead.
  if (deltaSubs.size === 0) { lastUnits = null; lastTag = ''; lastFullFrame = null }
  if (plainSubs.size + deltaSubs.size > 0) return
  if (hotPoller) { clearInterval(hotPoller); hotPoller = null; lastHot = '' }
  if (warmPoller) { clearInterval(warmPoller); warmPoller = null; lastWarm = '' }
  if (coldTick) { clearInterval(coldTick); coldTick = null }
}

// GET /api/graph/stream — one SSE per dashboard tab, server→client only, with a periodic `ping` so an
// idle proxy never times the connection out. On a backend hot-reload the stream drops and EventSource
// auto-reconnects to the fresh child; a delta subscriber's reconnect lands a fresh `graph-full`, so the
// chain re-anchors with no client-side repair logic.
export function boardStream(c: Context) {
  const delta = c.req.query('mode') === 'delta'
  ensureBoardFileWatchers()
  return streamSSE(c, async (stream) => {
    let aborted = false
    const send: DeltaSend = (frame) => { void stream.writeSSE(frame).catch(() => {}) }
    const notify: Notify = () => { void stream.writeSSE({ event: 'graph-changed', data: 'x' }).catch(() => {}) }
    if (delta) { deltaSubs.add(send); ensureColdTick() } else { plainSubs.add(notify) }
    ensurePollers()
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
        // ping every 10s — the client's heartbeat contract is 2.5× this window ([[graph-stream]]), so a
        // silent-death gap is caught inside one client watchdog interval, and idle proxies never time out.
        await stream.sleep(10000)
        if (aborted) break
        await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } finally { unsub() }
  })
}
