import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, readdirSync, readFileSync, type FSWatcher } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { sessionsRoot, gitCommonDir } from './layout.js'
import { hotSignature, warmSignature, listSessions } from './sessions.js'
import { getBoard, getBoardForSessionRefresh, invalidateBoard, patrolBoard } from './graphCache.js'
import { unitize, tagOf, diffUnits, type Units } from './graphDelta.js'
import {
  holdSessionEvalProjectionObserver,
  invalidateSessionEvalProjections,
  releaseSessionEvalProjectionObserver,
  setSessionEvalProjectionNotify,
  setSessionEvalProjectionWarmup,
} from '../../spec-eval/src/sessioneval.js'

type Scope = 'sessions' | 'full'
type EvalTarget = 'all' | { id?: string; path?: string }
type Notify = () => void
type Frame = { event: string; data: string }
type DeltaSend = (frame: Frame) => void
type TreeWatchCallback = (event: 'rename' | 'change', filename: string | Buffer | null) => void
// the one filesystem primitive the registry is allowed to call — `fs.watch`'s overloads narrowed to the
// exact shape both transports use, so an injected fake is the same three arguments.
type WatchFactory = (path: string, options: { recursive?: boolean }, callback: TreeWatchCallback) => FSWatcher
type WatchTransport = 'consolidated-recursive' | 'exact-directory'

type TreeWatcherOptions = {
  root: string
  source: string
  scope: Scope
  recursive?: boolean
  ignore?: (relativePath: string) => boolean
  watchFactory?: WatchFactory
  transport?: WatchTransport
  onInput: (event: 'rename' | 'change', relativePath: string) => void
  onFailure: (error: Error) => void
}

// @@@ watch transport - the ONE place the platform appears. Observing a tree is a single product-level
// registration; how many registrations the OS actually holds for it is the transport's business.
//   consolidated-recursive — the OS itself observes a whole subtree from one registration (Darwin
//     FSEvents, Windows ReadDirectoryChangesW). It reports by PATH, so an atomic replacement inside the
//     tree stays visible, and exclusions filter on delivery because nothing is consumed per directory.
//   exact-directory — no such observer exists (Linux), and Node's `recursive` option is a USERSPACE
//     fan-out registering one inotify watch per file AND directory (measured: 201 directories -> 801
//     watches) which, watching files by inode, goes blind the moment a file is atomically replaced. So
//     we enumerate directories once and install one NON-recursive watch each, all multiplexed onto the
//     loop's single shared inotify descriptor, excluding .git/node_modules at traversal time.
export const consolidatedRecursiveWatch = (platform: NodeJS.Platform = process.platform): boolean =>
  platform === 'darwin' || platform === 'win32'

// The live census across every registry: `sources` is what graph-stream asked the platform for (one per
// canonical root), `registrations` is what the platform is actually holding for them. Both are read by the
// watcher-budget tests and logged under SPEXCODE_BOARD_DEBUG, so a plateau is observable on every platform
// rather than only where /proc exposes inotify descriptors.
const liveRegistries = new Set<TreeWatcherRegistry>()
let liveRegistrations = 0
export function graphWatcherCensus(): { sources: number; registrations: number } {
  return { sources: liveRegistries.size, registrations: liveRegistrations }
}

export class TreeWatcherRegistry {
  readonly root: string
  readonly source: string
  readonly scope: Scope
  readonly transport: WatchTransport
  private readonly recursive: boolean
  private readonly ignore: (relativePath: string) => boolean
  private readonly watchFactory: WatchFactory
  private readonly onInput: TreeWatcherOptions['onInput']
  private readonly onFailure: TreeWatcherOptions['onFailure']
  private readonly handles = new Map<string, FSWatcher>()
  private refreshImmediate: ReturnType<typeof setImmediate> | null = null
  private failed = false

  constructor(options: TreeWatcherOptions) {
    this.root = resolve(options.root)
    this.source = options.source
    this.scope = options.scope
    this.recursive = options.recursive !== false
    this.transport = options.transport
      ?? (this.recursive && consolidatedRecursiveWatch() ? 'consolidated-recursive' : 'exact-directory')
    this.ignore = options.ignore ?? (() => false)
    this.watchFactory = options.watchFactory ?? (watch as unknown as WatchFactory)
    this.onInput = options.onInput
    this.onFailure = options.onFailure
  }

  get size(): number { return this.handles.size }
  paths(): string[] { return [...this.handles.keys()].sort() }
  // one kernel-side observer covers the subtree: the root is the only path we register, and no rename can
  // make the desired set drift, so there is nothing to re-walk.
  private get consolidated(): boolean { return this.recursive && this.transport === 'consolidated-recursive' }

  private desiredDirectories(): Set<string> {
    const desired = new Set<string>()
    const visit = (dir: string): void => {
      desired.add(dir)
      if (!this.recursive || this.consolidated) return
      let entries: import('node:fs').Dirent[]
      try { entries = readdirSync(dir, { withFileTypes: true }) }
      catch (error) {
        if (dir !== this.root && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          desired.delete(dir)
          return
        }
        throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        const path = join(dir, entry.name)
        const rel = relative(this.root, path)
        if (!this.ignore(rel)) visit(path)
      }
    }
    visit(this.root)
    return desired
  }

  private closeHandles(): void {
    if (this.refreshImmediate) { clearImmediate(this.refreshImmediate); this.refreshImmediate = null }
    const handles = [...this.handles.values()]
    this.handles.clear()
    liveRegistrations -= handles.length
    liveRegistries.delete(this)
    for (const handle of handles) { try { handle.close() } catch { /* already gone */ } }
  }

  private sourceError(path: string, error: unknown): Error {
    const err = error as NodeJS.ErrnoException
    const reason = error instanceof Error ? error.message : String(error)
    // source + path + errno, always — an exhausted platform must name which syscall budget it refused.
    const errno = err?.code && !reason.includes(err.code) ? ` (errno ${err.code})` : ''
    return new Error(`spec-cli: graph watcher '${this.source}' failed at ${path}: ${reason}${errno}`)
  }

  private fail(path: string, error: unknown): false {
    if (this.failed) return false
    this.failed = true
    this.closeHandles()
    this.onFailure(this.sourceError(path, error))
    return false
  }

  private scheduleRefresh(): void {
    if (this.refreshImmediate || this.failed) return
    this.refreshImmediate = setImmediate(() => {
      this.refreshImmediate = null
      this.refresh()
    })
    this.refreshImmediate.unref?.()
  }

  refresh(): boolean {
    if (this.refreshImmediate) { clearImmediate(this.refreshImmediate); this.refreshImmediate = null }
    this.failed = false
    let desired: Set<string>
    try { desired = this.desiredDirectories() }
    catch (error) { return this.fail(this.root, error) }

    const before = this.handles.size
    for (const [path, handle] of [...this.handles]) {
      if (desired.has(path)) continue
      this.handles.delete(path)
      liveRegistrations--
      try { handle.close() } catch { /* already gone */ }
    }
    const options = this.consolidated ? { recursive: true } : {}
    for (const path of desired) {
      if (this.handles.has(path)) continue
      try {
        let handle: FSWatcher
        const callback: TreeWatchCallback = (event, filename) => {
          if (this.handles.get(path) !== handle) return
          if (filename == null) { this.fail(path, new Error('pathless filesystem event')); return }
          const inputPath = resolve(path, String(filename))
          const rel = relative(this.root, inputPath)
          if (rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || rel === '..') {
            this.fail(path, new Error(`event escaped watcher root: ${String(filename)}`))
            return
          }
          if (this.ignore(rel)) return
          this.onInput(event, rel)
          // only the userspace transport's desired set can drift: a new directory under a consolidated
          // observer is already covered by the kernel.
          if (this.recursive && !this.consolidated && event === 'rename') this.scheduleRefresh()
        }
        handle = this.watchFactory(path, options, callback)
        this.handles.set(path, handle)
        liveRegistrations++
        handle.on('error', (error) => {
          if (this.handles.get(path) === handle) this.fail(path, error)
        })
      } catch (error) { return this.fail(path, error) }
    }
    if (this.handles.size) liveRegistries.add(this)
    if (DEBUG && this.handles.size !== before)
      console.warn(`spec-cli: graph watchers — sources=${liveRegistries.size} registrations=${liveRegistrations} (${this.source}: ${this.transport} ${this.handles.size})`)
    return true
  }

  close(): void {
    this.failed = false
    this.closeHandles()
  }
}

const plainSubs = new Set<Notify>()
const deltaSubs = new Set<DeltaSend>()
let debounce: ReturnType<typeof setTimeout> | null = null
let pendingFull = false
let pendingSessions = false
export type PendingGraphChanges = { full: boolean; sessions: boolean }
export const addPendingGraphChange = (pending: PendingGraphChanges, scope: Scope): PendingGraphChanges => ({
  full: pending.full || scope === 'full',
  sessions: pending.sessions || scope === 'sessions',
})

// under SPEXCODE_BOARD_DEBUG=1, every broadcast logs its changed unit keys + trigger tags + build ms.
const DEBUG = process.env.SPEXCODE_BOARD_DEBUG === '1'
function traceLatency(stage: 'sessions-signal' | 'session-projection-complete' | 'broadcast', detail: Record<string, unknown> = {}): void {
  if (DEBUG) console.warn(`spec-cli: graph latency ${JSON.stringify({ at: Date.now(), stage, ...detail })}`)
}
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
let patrolPending = false
let sessionRefreshRequested = false
let wakeSessionRefresh: (() => void) | null = null

async function rebuildAndBroadcast(patrol = false, sessions = false, full = false): Promise<void> {
  if (patrol) patrolPending = true
  if (sessions) sessionRefreshRequested = true
  if (building) {
    dirty = true
    if (sessions) {
      wakeSessionRefresh?.()
      wakeSessionRefresh = null
    }
    return
  }
  building = true
  try {
    do {
      dirty = false
      const validate = patrolPending
      patrolPending = false
      const sessionsFirst = sessionRefreshRequested
      sessionRefreshRequested = false
      let servedSessionProjection = sessionsFirst
      let board: unknown
      // share the route's single-flight build ([[graph-cache]]); fireChanged() already invalidated the
      // cache (at the accumulated scope), so this gets a fresh build/splice (or joins one a concurrent poll
      // already started). The patrol instead asks that same cache flight to validate its input revision;
      // equal inputs return the anchor without invoking a producer.
      const t0 = Date.now()
      try {
        if (sessionsFirst) {
          board = await getBoardForSessionRefresh()
          if (validate) { patrolPending = true; dirty = true }
        }
        else {
          let wake!: () => void
          const sessionWake = new Promise<void>((resolve) => { wake = resolve })
          wakeSessionRefresh = wake
          const boardWait = validate ? patrolBoard() : getBoard()
          const outcome = await Promise.race([
            boardWait.then((value) => ({ value })),
            sessionWake.then(() => ({ value: null as unknown })),
          ])
          if (wakeSessionRefresh === wake) wakeSessionRefresh = null
          if (outcome.value === null) {
            boardWait.catch(() => {})
            board = await getBoardForSessionRefresh()
            servedSessionProjection = true
            if (validate) patrolPending = true
            dirty = true // the full wait was preempted only for delivery; it remains owed.
          } else board = outcome.value
        }
      }
      catch {
        // A failed refresh consumes no cause: graph-cache restores the producer scope, so its stream-side
        // attribution must remain owed too. This also retains watcher causes that arrived while the failed
        // flight was occupied. A later patrol may recover the work, but it is then one cause alongside those
        // healthy leaf signals rather than a false patrol-only blind-watcher repair.
        for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }
        continue
      }
      const buildMs = Date.now() - t0
      if (servedSessionProjection) traceLatency('session-projection-complete', { patrol: validate })
      const boardJson = JSON.stringify(board)
      const { units, ok } = unitize(board as Record<string, unknown>)
      const tag = tagOf(units)
      // A session-first frame consumes its own cause, but a full/patrol cause remains owed until structural
      // convergence. Otherwise the first cheap projection would erase patrol accountability before the full
      // result could name it. A normal frame consumes its whole trigger set, including a no-op frame.
      const tags = [...triggerTags]
      triggerTags.clear()
      if (servedSessionProjection)
        for (const tag of tags) if (tag === 'full' || tag === 'patrol') triggerTags.add(tag)
      if (sessionsFirst && full) dirty = true
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
      traceLatency('broadcast', { event: frame.event, sessionProjection: servedSessionProjection, tags, changedKeys })
      for (const send of [...deltaSubs]) { try { send(frame) } catch { /* swept on abort */ } }
      for (const n of [...plainSubs]) { try { n() } catch { /* swept on abort */ } }
      // ---- repair accounting: a real (tag-moved) broadcast whose ONLY trigger was the cold-tick patrol
      // means a leaf watcher was BLIND — the patrol self-healed it. That is a bug report, not routine, so
      // it is ALWAYS loud (repairs are supposed to be zero — [[graph-stream]]). Under DEBUG, every
      // broadcast logs its changed keys + triggers + build ms.
      if (changedKeys.length && tags.length === 1 && tags[0] === 'patrol')
        console.warn(`spec-cli: PATROL-REPAIR — the cold tick caught a change no leaf watcher pushed; changed units: [${changedKeys.join(', ')}] — a blind watcher, investigate`)
      if (DEBUG)
        console.warn(`spec-cli: graph broadcast — changed [${changedKeys.join(', ')}] triggers {${tags.join(', ')}} build ${buildMs}ms`)
    } while (dirty)
  } finally { building = false }
}

// a merge/launch/close touches several record files at once; collapse the burst into ONE signal. Each call
// carries its own change SCOPE: full and sessions are independent obligations, not a max-scope replacement.
// With delta subscribers the debounced fire rebuilds and broadcasts (plain subs then ride the same
// tag-moved gate — no spurious refetches); without them it stays the zero-build legacy notify.
function fireChanged(scope: Scope = 'full', evalTarget?: EvalTarget): void {
  // Advance eval input generations BEFORE invalidating/building the board, so the first frame caused by an
  // input event is `updating(lastKnown)`. Summary completion calls this function without a target.
  if (scope === 'sessions') traceLatency('sessions-signal')
  if (evalTarget) invalidateSessionEvalProjections(evalTarget)
  const pending = addPendingGraphChange({ full: pendingFull, sessions: pendingSessions }, scope)
  pendingFull = pending.full
  pendingSessions = pending.sessions
  // invalidate the route's board cache ([[graph-cache]]) on EVERY change signal at its OWN scope,
  // before the debounce guard — a plain-mode client that polls /api/graph (no delta rebuild here) must
  // still see fresh data on its next poll, and a delta rebuild below re-reads the same now-stale cache.
  invalidateBoard(scope)
  triggerTags.add(scope)
  // DEBOUNCE = 25ms. Real fs-event bursts (a merge touching many records) were MEASURED to span 0–5ms, so a
  // 25ms window collapses them with room to spare while shaving ~125ms off the old 150ms lag; anything
  // wider than the window is coalesced anyway by the in-flight build's dirty-rerun loop, which is the real
  // burst absorber. So the debounce is a micro-collapse, not the coalescer.
  if (debounce) return
  debounce = setTimeout(() => {
    debounce = null
    const full = pendingFull, sessions = pendingSessions
    pendingFull = false
    pendingSessions = false
    if (deltaSubs.size) void rebuildAndBroadcast(false, sessions, full)
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

// ---- ONE repair scheduler for every filesystem source ----
// A source the platform refuses keeps its observer hold and is retried by THIS timer alone — never by a
// graph build, an HTTP read, a poller tick or a registry event. That is the whole anti-storm rule: the
// resource being exhausted (a registration budget, a descriptor table) is PROCESS-wide, so its backoff
// belongs to the process, not to each source racing its own retry and re-walking the corpus every time.
// `heldSources` is what an ordinary pass may not re-attempt; only the scheduled pass lifts that.
const heldSources = new Set<string>()
let repairTimer: ReturnType<typeof setTimeout> | null = null
let repairStep = 0
let repairing = false

const mayAttach = (source: string): boolean => repairing || !heldSources.has(source)

// The failure is loud ONCE per episode and names source + path + errno (the registry built that message);
// every later source felled by the same exhausted budget is counted, not re-printed, and the repair line
// reports the total. A half-attached registry is already closed by the registry itself before we get here.
function noteSourceFailure(source: string, error: unknown): void {
  const known = heldSources.has(source)
  heldSources.add(source)
  if (!known && heldSources.size === 1) console.error(error instanceof Error ? error.message : String(error))
  scheduleWatcherRepair()
}

function noteSourceHealthy(source: string): void {
  if (!heldSources.delete(source)) return
  if (heldSources.size === 0) repairStep = 0
}

function scheduleWatcherRepair(): void {
  if (repairTimer || !heldSources.size) return
  const delay = Math.min(30_000, 250 * 2 ** Math.min(repairStep, 7))
  repairStep++
  const era = watcherEra
  console.error(`spec-cli: graph watcher repair — ${heldSources.size} source(s) held, retrying in ${delay}ms; the cold-tick patrol covers the gap until they reattach`)
  repairTimer = setTimeout(() => {
    repairTimer = null
    if (era !== watcherEra) return
    repairing = true
    void ensureBoardFileWatchers()
      .catch((error) => console.error(`spec-cli: graph watcher repair failed — ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        repairing = false
        if (heldSources.size) scheduleWatcherRepair()
      })
  }, delay)
  repairTimer.unref?.()
}

// ---- event source 1: the session store (lifecycle status writes) → 'sessions' ----
let activeStoreRoot: string | null = null
let activeCommonRoot: string | null = null
let watcherEra = 0
let storeWatcher: TreeWatcherRegistry | null = null

function ensureWatcher(root: string): void {
  if (storeWatcher?.root === root) return
  if (storeWatcher) { storeWatcher.close(); storeWatcher = null }
  if (isDisabled('store') || !mayAttach('store')) return
  try { mkdirSync(root, { recursive: true }) }
  catch (error) {
    console.error(`spec-cli: graph watcher 'store' could not create ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const registry = new TreeWatcherRegistry({
    root,
    source: 'store',
    scope: 'sessions',
    onInput: () => fireChanged('sessions'),
    onFailure: (error) => {
      if (storeWatcher === registry) storeWatcher = null
      noteSourceFailure('store', error)
      fireChanged('sessions')
    },
  })
  storeWatcher = registry
  if (!registry.refresh()) {
    if (storeWatcher === registry) storeWatcher = null
    return
  }
  noteSourceHealthy('store')
}

// ---- event source 2: git refs (a commit/merge reshapes the tree the moment the ref moves) → 'full' ----
// refs/ recursively for loose refs (heads, worktree branches), plus the common dir itself non-recursively
// for packed-refs rewrites and HEAD flips. Ordinary graph units still have the patrol; eval projections are
// observer-held across a failure and only become current after a replacement watch authorizes a rescan.
type RegistryGroup = {
  root: string
  close(): void
}
let refsWatchers: RegistryGroup | null = null
const REFS_OBSERVER = 'graph:refs'

export function watchSessionEvalRefs(
  common: string,
  onInput: () => void,
  onFailure: (error: Error) => void,
): RegistryGroup {
  let attached: TreeWatcherRegistry[] = []
  let failed = false
  let ready = false
  let attachError: Error | null = null
  const close = () => {
    const registries = attached
    attached = []
    for (const registry of registries) registry.close()
  }
  const fail = (error: Error) => {
    if (failed) return
    failed = true
    close()
    if (ready) onFailure(error)
    else attachError = error
  }
  const refs = new TreeWatcherRegistry({
    root: join(common, 'refs'),
    source: 'refs',
    scope: 'full',
    onInput: () => onInput(),
    onFailure: fail,
  })
  attached.push(refs)
  if (!refs.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'refs' failed at ${refs.root}`)

  const commonFiles = new TreeWatcherRegistry({
    root: common,
    source: 'refs-common',
    scope: 'full',
    recursive: false,
    onInput: (_event, file) => { if (file === 'packed-refs' || file === 'HEAD') onInput() },
    onFailure: fail,
  })
  attached.push(commonFiles)
  if (!commonFiles.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'refs-common' failed at ${common}`)
  ready = true
  return { root: resolve(common), close }
}

function refsWatcherFailed(error: Error): void {
  refsWatchers = null
  noteSourceFailure('refs', error)
  if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
}

function ensureRefsWatcher(common = activeCommonRoot): void {
  if (!common) return
  if (refsWatchers?.root === common) return
  if (refsWatchers) { refsWatchers.close(); refsWatchers = null }
  if (isDisabled('refs')) {
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
    return
  }
  if (!mayAttach('refs')) return
  try {
    refsWatchers = watchSessionEvalRefs(common, () => fireChanged('full', 'all'), refsWatcherFailed)
    noteSourceHealthy('refs')
    if (releaseSessionEvalProjectionObserver(REFS_OBSERVER)) fireChanged('full')
  } catch (error) {
    refsWatchers = null
    noteSourceFailure('refs', error)
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
  }
}

// ---- event source 3: worktree registry + working roots + per-worktree indexes → 'full' ----
// Summary inputs include ordinary dirty source and staged-only changes, not just `.spec`. Each live
// worktree is therefore TWO canonical roots — its working tree and git's metadata dir for it (`index`) —
// and that pair is the whole per-worktree registration cost, whatever the corpus inside it holds.
let registryWatcher: TreeWatcherRegistry | null = null
let registryReady = false
type WorktreeWatch = {
  path: string
  root: TreeWatcherRegistry
  index: TreeWatcherRegistry
  close(): void
}
const worktreeWatchers = new Map<string, WorktreeWatch>()
const worktreeObserver = (name: string): string => `graph:worktree:${name}`
const worktreeSource = (name: string): string => `worktree:${name}`

const ignoredWorktreePath = (file: string): boolean =>
  file.split(/[\\/]/).some((segment) => segment === '.git' || segment === 'node_modules')

export function watchSessionEvalWorktree(
  wtPath: string,
  gitDir: string,
  onInput: () => void,
  onFailure: (error: Error) => void,
): WorktreeWatch {
  let failed = false
  let ready = false
  let attachError: Error | null = null
  let root: TreeWatcherRegistry | null = null
  let index: TreeWatcherRegistry | null = null
  const close = () => {
    root?.close()
    index?.close()
  }
  const fail = (error: Error) => {
    if (failed) return
    failed = true
    close()
    if (ready) onFailure(error)
    else attachError = error
  }
  root = new TreeWatcherRegistry({
    root: wtPath,
    source: `worktree:${resolve(wtPath)}`,
    scope: 'full',
    ignore: ignoredWorktreePath,
    onInput: () => onInput(),
    onFailure: fail,
  })
  if (!root.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'worktree' failed at ${wtPath}`)
  index = new TreeWatcherRegistry({
    root: gitDir,
    source: `worktree-index:${resolve(wtPath)}`,
    scope: 'full',
    recursive: false,
    onInput: (_event, file) => { if (file === 'index') onInput() },
    onFailure: fail,
  })
  if (!index.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'worktree-index' failed at ${gitDir}`)
  ready = true
  return { path: resolve(wtPath), root, index, close }
}

function dropWorktreeWatcher(name: string): WorktreeWatch | null {
  const row = worktreeWatchers.get(name)
  if (!row) return null
  worktreeWatchers.delete(name)
  row.close()
  return row
}

function watcherFailed(name: string, path: string, error: Error): void {
  // Failure/overflow has no trustworthy path. Keep last-known, mark the target updating, and hand the
  // reattach to the one repair scheduler; the authorized summary build is the one authoritative rescan,
  // never a periodic sweep and never a re-walk driven by whatever read noticed the failure.
  dropWorktreeWatcher(name)
  noteSourceFailure(worktreeSource(name), error)
  if (holdSessionEvalProjectionObserver(worktreeObserver(name), { path })) fireChanged('full')
}

const forcedWorktreeSessions = new Set<string>()
let worktreeReconcileFlight: Promise<void> | null = null

export function sessionWorktreeWatchPaths(
  sessions: { id: string; path: string; liveness?: string }[],
  forcedSessions: Set<string> = new Set(),
): Set<string> {
  return new Set(sessions
    .filter((session) => session.liveness !== 'offline' || forcedSessions.has(session.id))
    .map((session) => resolve(session.path)))
}

async function reconcileWorktreePass(forcedSessions: Set<string>, era: number, common: string): Promise<void> {
  const dir = join(common, 'worktrees')
  let sessions: Awaited<ReturnType<typeof listSessions>>
  try { sessions = await listSessions() } catch { return }
  if (era !== watcherEra) return
  const wantedPaths = sessionWorktreeWatchPaths(sessions, forcedSessions)
  let ents: import('node:fs').Dirent[] = []
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { /* no worktrees registry yet */ }
  const wantedNames = new Set<string>()
  let released = false
  for (const e of ents) {
    if (!e.isDirectory()) continue
    let wtPath: string
    try { wtPath = dirname(readFileSync(join(dir, e.name, 'gitdir'), 'utf8').trim()) } catch { continue }
    const normalizedPath = resolve(wtPath)
    if (!wantedPaths.has(normalizedPath)) {
      if (dropWorktreeWatcher(e.name)) released = releaseSessionEvalProjectionObserver(worktreeObserver(e.name)) || released
      noteSourceHealthy(worktreeSource(e.name))
      continue
    }
    wantedNames.add(e.name)
    const existing = worktreeWatchers.get(e.name)
    if (existing?.path === normalizedPath) continue
    const rootChanged = existing != null
    if (existing) dropWorktreeWatcher(e.name)
    // a held worktree is the repair scheduler's to reattach — an ordinary reconcile pass must not re-walk
    // it, which is what turned one refused registration into a per-read attach storm.
    if (!mayAttach(worktreeSource(e.name))) continue
    try {
      // the entry's `gitdir` file points at the worktree's `<tree>/.git` (file or dir); its parent is the tree.
      const row = watchSessionEvalWorktree(
        wtPath,
        join(dir, e.name),
        () => fireChanged('full', { path: wtPath }),
        (error) => watcherFailed(e.name, wtPath, error),
      )
      if (era !== watcherEra) { row.close(); return }
      worktreeWatchers.set(e.name, row)
      noteSourceHealthy(worktreeSource(e.name))
      if (rootChanged) fireChanged('full', { path: wtPath })
      // The replacement is live before its hold is removed. This delta authorizes one double-read rescan,
      // so edits made anywhere in the unwatched interval are inside the new generation's fingerprint.
      if (releaseSessionEvalProjectionObserver(worktreeObserver(e.name))) fireChanged('full')
    } catch (error) {
      // An attach failure is observable: mark unknown/full now. The repair scheduler owns the reattach; no
      // patrol is allowed to call the eval projection current meanwhile.
      noteSourceFailure(worktreeSource(e.name), error)
      if (holdSessionEvalProjectionObserver(worktreeObserver(e.name), { path: wtPath })) fireChanged('full')
    }
  }
  for (const name of worktreeWatchers.keys()) if (!wantedNames.has(name)) {
    dropWorktreeWatcher(name)
    released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
  }
  for (const source of [...heldSources]) {
    const name = source.startsWith('worktree:') ? source.slice('worktree:'.length) : null
    if (name && !wantedNames.has(name)) {
      noteSourceHealthy(source)
      released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
    }
  }
  if (released) fireChanged('full')
}

function reconcileWorktrees(forceSessionId?: string): Promise<void> {
  // Blinding a leaf must blind it from EVERY entry point. Reconciliation is reached from the liveness
  // poller and from registry events as well as from the ensure pass, so gating only the ensure pass left
  // the per-worktree observers attaching anyway — the injection looked applied while the leaf still saw
  // everything, which makes the patrol's accountability untestable rather than merely untested.
  if (isDisabled('worktrees')) return Promise.resolve()
  if (forceSessionId) forcedWorktreeSessions.add(forceSessionId)
  if (worktreeReconcileFlight) return worktreeReconcileFlight
  const era = watcherEra
  const common = activeCommonRoot
  if (!common) return Promise.resolve()
  const flight = (async () => {
    do {
      if (era !== watcherEra) return
      const forced = new Set(forcedWorktreeSessions)
      forcedWorktreeSessions.clear()
      await reconcileWorktreePass(forced, era, common)
    } while (forcedWorktreeSessions.size)
  })().finally(() => { if (worktreeReconcileFlight === flight) worktreeReconcileFlight = null })
  worktreeReconcileFlight = flight
  void flight.catch((error) => {
    console.warn(`spec-cli: worktree watcher reconciliation failed — ${error instanceof Error ? error.message : String(error)}`)
  })
  return flight
}
const WORKTREE_REGISTRY_OBSERVER = 'graph:worktree-registry'

export function watchSessionEvalRegistry(
  dir: string,
  onInput: () => void,
  onFailure: (error: Error) => void,
): TreeWatcherRegistry {
  let ready = false
  let attachError: Error | null = null
  const registry = new TreeWatcherRegistry({
    root: dir,
    source: 'worktree-registry',
    scope: 'full',
    recursive: false,
    onInput: () => onInput(),
    onFailure: (error) => {
      if (ready) onFailure(error)
      else attachError = error
    },
  })
  if (!registry.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'worktree-registry' failed at ${dir}`)
  ready = true
  return registry
}

function registryWatcherFailed(error: Error): void {
  registryWatcher = null
  registryReady = false
  noteSourceFailure('worktree-registry', error)
  if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
}

async function ensureWorktreeRegistry(forceSessionId?: string): Promise<void> {
  const common = activeCommonRoot
  if (!common) return
  const dir = resolve(join(common, 'worktrees'))
  // The registry watcher already reconciles add/remove events. Re-scanning every ordinary graph/evals read
  // turns a large worktree registry into an artificial request latency floor; only a scoped read may demand
  // one target after startup, while the unscoped hot path reuses the attached live watchers.
  // an attached registry short-circuits the scan for ordinary reads, but a REPAIR pass exists precisely to
  // reattach held worktrees, so it must reach the reconcile even when the registry itself is healthy.
  if (registryWatcher?.root === dir) {
    if (forceSessionId || repairing) await reconcileWorktrees(forceSessionId)
    return
  }
  if (registryWatcher) { registryWatcher.close(); registryWatcher = null; registryReady = false }
  // A platform may reject registry watches. Once the initial reconciliation has run, ordinary
  // reads must not repeat its full worktree scan while the repair pass is pending; scoped reads can
  // still demand their target explicitly.
  if (registryReady && !forceSessionId && !repairing) return
  if (registryReady && (forceSessionId || repairing)) { await reconcileWorktrees(forceSessionId); return }
  if (isDisabled('worktrees')) {
    registryReady = true
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
    return
  }
  if (!mayAttach('worktree-registry')) return
  registryReady = true
  try {
    try { mkdirSync(dir, { recursive: true }) }
    catch (error) { console.error(`spec-cli: graph watcher 'worktree-registry' could not create ${dir}: ${error instanceof Error ? error.message : String(error)}`) }
    // a registry add/remove is itself a 'full' change (a new/gone worktree reshapes the overlay); also
    // reconcile the per-worktree `.spec` watchers on every registry event.
    registryWatcher = watchSessionEvalRegistry(dir, () => {
      void reconcileWorktrees()
      fireChanged('full', 'all')
    }, registryWatcherFailed)
    noteSourceHealthy('worktree-registry')
  } catch (error) {
    registryWatcher = null
    registryReady = false
    noteSourceFailure('worktree-registry', error)
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
  }
  await reconcileWorktrees(forceSessionId)   // attach for the live/demanded worktrees that already exist
  if (registryWatcher && releaseSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER)) fireChanged('full')
}

// Attach the canonical filesystem sources before an HTTP snapshot starts summary work. This closes the
// request→SSE handoff gap: an edit after the snapshot build has a watcher before it can occur. A source
// the platform refused is NOT retried here — it is held for the repair scheduler, so an HTTP read never
// becomes a reattach loop.
export async function ensureBoardFileWatchers(forceSessionId?: string): Promise<void> {
  const storeRoot = resolve(sessionsRoot())
  const commonRoot = resolve(gitCommonDir())
  if ((activeStoreRoot && activeStoreRoot !== storeRoot) || (activeCommonRoot && activeCommonRoot !== commonRoot))
    closeBoardFileWatchers()
  activeStoreRoot = storeRoot
  activeCommonRoot = commonRoot
  ensureWatcher(storeRoot)
  ensureRefsWatcher(commonRoot)
  await ensureWorktreeRegistry(forceSessionId)
}

export function closeBoardFileWatchers(): void {
  watcherEra++
  if (repairTimer) { clearTimeout(repairTimer); repairTimer = null }
  heldSources.clear()
  repairStep = 0
  repairing = false
  forcedWorktreeSessions.clear()
  worktreeReconcileFlight = null

  storeWatcher?.close()
  storeWatcher = null
  refsWatchers?.close()
  refsWatchers = null
  registryWatcher?.close()
  registryWatcher = null
  registryReady = false
  for (const [name, row] of worktreeWatchers) {
    row.close()
    releaseSessionEvalProjectionObserver(worktreeObserver(name))
  }
  worktreeWatchers.clear()
  releaseSessionEvalProjectionObserver(REFS_OBSERVER)
  releaseSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER)
  activeStoreRoot = null
  activeCommonRoot = null
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
    void hotSignature().then((sig) => {
      if (sig !== lastHot) { lastHot = sig; void reconcileWorktrees(); fireChanged('sessions') }
    }).catch(() => {})
  }, 100)
  if (!warmPoller) warmPoller = setInterval(() => {
    void warmSignature().then((sig) => { if (sig !== lastWarm) { lastWarm = sig; fireChanged('sessions') } }).catch(() => {})
  }, 1000)
}

// ---- event source 5: the cold-tick PATROL — the server-side replacement for every client's slow fallback
// poll, AND the self-heal authority. A relaxed tick asks graph-cache's ONE flight to compare its board-input
// revision: unchanged state returns the anchor without assembly, while an unobserved ref/worktree/store move
// escalates there to a full rebuild. The 'patrol' tag keeps that repair accountable. Delta-gated: plain-only
// clients keep their own client-side fallback, so without delta subscribers this does no validation work.
let coldTick: ReturnType<typeof setInterval> | null = null
function ensureColdTick(): void {
  if (coldTick) return
  coldTick = setInterval(() => {
    if (!deltaSubs.size) return
    triggerTags.add('patrol')
    void rebuildAndBroadcast(true)
  }, 15000)
}

function stopSourcesIfIdle(): void {
  // the delta anchor dies with its era's last subscriber: past this point changes invalidate the cache but
  // never rebuild, so lastFullFrame would drift arbitrarily far from the real board — and the next era's
  // first subscriber would be anchored on it (its warm-terminal set then drops live sessions' panes, and the
  // client's recovery lanes can latch each other out — issue #70). A new era opens on a fresh build instead.
  if (deltaSubs.size === 0) { lastUnits = null; lastTag = ''; lastFullFrame = null; patrolPending = false }
  if (deltaSubs.size === 0) setSessionEvalProjectionWarmup(false)
  if (plainSubs.size + deltaSubs.size > 0) return
  if (hotPoller) { clearInterval(hotPoller); hotPoller = null; lastHot = '' }
  if (warmPoller) { clearInterval(warmPoller); warmPoller = null; lastWarm = '' }
  if (coldTick) { clearInterval(coldTick); coldTick = null }
}

// GET /api/graph/stream — one SSE per dashboard tab, server→client only, with a periodic `ping` so an
// idle proxy never times the connection out. On a backend hot-reload the stream drops and EventSource
// auto-reconnects to the fresh child; a delta subscriber's reconnect lands a fresh `graph-full`, so the
// chain re-anchors with no client-side repair logic.
export async function boardStream(c: Context) {
  const delta = c.req.query('mode') === 'delta'
  await ensureBoardFileWatchers()
  return streamSSE(c, async (stream) => {
    let aborted = false
    const send: DeltaSend = (frame) => { void stream.writeSSE(frame).catch(() => {}) }
    const notify: Notify = () => { void stream.writeSSE({ event: 'graph-changed', data: 'x' }).catch(() => {}) }
    if (delta) {
      deltaSubs.add(send)
      setSessionEvalProjectionWarmup(true)
      ensureColdTick()
    } else { plainSubs.add(notify) }
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
