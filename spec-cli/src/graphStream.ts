import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { watch, mkdirSync, readdirSync, readFileSync, type FSWatcher } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'
import { sessionsRoot, gitCommonDir } from './layout.js'
import { hotSignature, warmSignature, listSessions } from './sessions.js'
import { getBoard, invalidateBoard } from './graphCache.js'
import { unitize, tagOf, diffUnits, type Units } from './graphDelta.js'
import {
  holdSessionEvalProjectionObserver,
  invalidateSessionEvalProjections,
  releaseSessionEvalProjectionObserver,
  setSessionEvalProjectionNotify,
  setSessionEvalProjectionWarmup,
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
type WatchFactory = typeof watch
type ExactWatchCallback = (event: 'rename' | 'change', filename: string | Buffer | null) => void

type ExactTreeWatcherOptions = {
  root: string
  source: string
  scope: Scope
  recursive?: boolean
  ignore?: (relativePath: string) => boolean
  watchFactory?: WatchFactory
  onInput: (event: 'rename' | 'change', relativePath: string) => void
  onFailure: (error: Error) => void
}

// Node's Linux recursive fs.watch expands one JS object into one inotify registration per file AND
// directory. This registry recurses in userspace once, then watches directories non-recursively: atomic file
// replacement stays visible through its parent, and a refresh is an idempotent set reconciliation.
export class ExactTreeWatcherRegistry {
  readonly root: string
  readonly source: string
  readonly scope: Scope
  private readonly recursive: boolean
  private readonly ignore: (relativePath: string) => boolean
  private readonly watchFactory: WatchFactory
  private readonly onInput: ExactTreeWatcherOptions['onInput']
  private readonly onFailure: ExactTreeWatcherOptions['onFailure']
  private readonly handles = new Map<string, FSWatcher>()
  private refreshImmediate: ReturnType<typeof setImmediate> | null = null
  private failed = false

  constructor(options: ExactTreeWatcherOptions) {
    this.root = resolve(options.root)
    this.source = options.source
    this.scope = options.scope
    this.recursive = options.recursive !== false
    this.ignore = options.ignore ?? (() => false)
    this.watchFactory = options.watchFactory ?? watch
    this.onInput = options.onInput
    this.onFailure = options.onFailure
  }

  get size(): number { return this.handles.size }
  paths(): string[] { return [...this.handles.keys()].sort() }

  private desiredDirectories(): Set<string> {
    const desired = new Set<string>()
    const visit = (dir: string): void => {
      desired.add(dir)
      if (!this.recursive) return
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
    for (const handle of handles) { try { handle.close() } catch { /* already gone */ } }
  }

  private sourceError(path: string, error: unknown): Error {
    const reason = error instanceof Error ? error.message : String(error)
    return new Error(`spec-cli: graph watcher '${this.source}' failed at ${path}: ${reason}`)
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

    for (const [path, handle] of [...this.handles]) {
      if (desired.has(path)) continue
      this.handles.delete(path)
      try { handle.close() } catch { /* already gone */ }
    }
    for (const path of desired) {
      if (this.handles.has(path)) continue
      try {
        let handle: FSWatcher
        const callback: ExactWatchCallback = (event, filename) => {
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
          if (this.recursive && event === 'rename') this.scheduleRefresh()
        }
        handle = (this.watchFactory as unknown as (path: string, callback: ExactWatchCallback) => FSWatcher)(path, callback)
        this.handles.set(path, handle)
        handle.on('error', (error) => {
          if (this.handles.get(path) === handle) this.fail(path, error)
        })
      } catch (error) { return this.fail(path, error) }
    }
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
let activeStoreRoot: string | null = null
let activeCommonRoot: string | null = null
let watcherEra = 0
let storeWatcher: ExactTreeWatcherRegistry | null = null
let storeRetryImmediate: ReturnType<typeof setImmediate> | null = null

function scheduleStoreRetry(): void {
  if (storeRetryImmediate) return
  const era = watcherEra
  storeRetryImmediate = setImmediate(() => {
    storeRetryImmediate = null
    if (era === watcherEra && activeStoreRoot) ensureWatcher(activeStoreRoot, false)
  })
  storeRetryImmediate.unref?.()
}

function ensureWatcher(root: string, retry = true): void {
  if (storeWatcher?.root === root) return
  if (storeWatcher) { storeWatcher.close(); storeWatcher = null }
  if (isDisabled('store')) return
  try { mkdirSync(root, { recursive: true }) }
  catch (error) {
    console.error(`spec-cli: graph watcher 'store' could not create ${root}: ${error instanceof Error ? error.message : String(error)}`)
  }
  let ready = false
  const registry = new ExactTreeWatcherRegistry({
    root,
    source: 'store',
    scope: 'sessions',
    onInput: () => fireChanged('sessions'),
    onFailure: (error) => {
      if (storeWatcher === registry) storeWatcher = null
      console.error(error.message)
      fireChanged('sessions')
      if (ready || retry) scheduleStoreRetry()
    },
  })
  storeWatcher = registry
  if (!registry.refresh()) {
    if (storeWatcher === registry) storeWatcher = null
    return
  }
  ready = true
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
let refsRetryImmediate: ReturnType<typeof setImmediate> | null = null
const REFS_OBSERVER = 'graph:refs'

export function watchSessionEvalRefs(
  common: string,
  onInput: () => void,
  onFailure: (error: Error) => void,
): RegistryGroup {
  let attached: ExactTreeWatcherRegistry[] = []
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
  const refs = new ExactTreeWatcherRegistry({
    root: join(common, 'refs'),
    source: 'refs',
    scope: 'full',
    onInput: () => onInput(),
    onFailure: fail,
  })
  attached.push(refs)
  if (!refs.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'refs' failed at ${refs.root}`)

  const commonFiles = new ExactTreeWatcherRegistry({
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

function scheduleRefsRetry(): void {
  if (refsRetryImmediate) return
  const era = watcherEra
  refsRetryImmediate = setImmediate(() => {
    refsRetryImmediate = null
    if (era === watcherEra && activeCommonRoot) ensureRefsWatcher(false, activeCommonRoot)
  })
  refsRetryImmediate.unref?.()
}

function refsWatcherFailed(error: Error): void {
  refsWatchers = null
  console.error(error.message)
  if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
  scheduleRefsRetry()
}

function ensureRefsWatcher(retry = true, common = activeCommonRoot): void {
  if (!common) return
  if (refsWatchers?.root === common) return
  if (refsWatchers) { refsWatchers.close(); refsWatchers = null }
  if (isDisabled('refs')) {
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
    return
  }
  try {
    refsWatchers = watchSessionEvalRefs(common, () => fireChanged('full', 'all'), refsWatcherFailed)
    if (releaseSessionEvalProjectionObserver(REFS_OBSERVER)) fireChanged('full')
  } catch (error) {
    refsWatchers = null
    console.error(error instanceof Error ? error.message : String(error))
    if (holdSessionEvalProjectionObserver(REFS_OBSERVER, 'all')) fireChanged('full')
    if (retry) scheduleRefsRetry()
  }
}

// ---- event source 3: worktree registry + working roots + per-worktree indexes → 'full' ----
// Summary inputs include ordinary dirty source and staged-only changes, not just `.spec`. Each registry row
// therefore owns an exact-directory tree registry plus one exact watcher on git's worktree metadata dir
// (`index`). A delivered event advances that worktree's eval generation before the graph rebuild.
let registryWatcher: ExactTreeWatcherRegistry | null = null
let registryReady = false
let registryRetryImmediate: ReturnType<typeof setImmediate> | null = null
type WorktreeWatch = {
  path: string
  root: ExactTreeWatcherRegistry
  index: ExactTreeWatcherRegistry
  close(): void
}
const worktreeWatchers = new Map<string, WorktreeWatch>()
const worktreeRetryAttempted = new Set<string>()
const worktreeRetryCount = new Map<string, number>()
const worktreeRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
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
  const era = watcherEra
  worktreeRetryAttempted.add(name)
  const timer = setTimeout(() => {
    worktreeRetryTimers.delete(name)
    worktreeRetryAttempted.delete(name)
    if (era === watcherEra) void reconcileWorktrees()
  }, delayMs)
  timer.unref?.()
  worktreeRetryTimers.set(name, timer)
  return true
}

function clearWorktreeRetry(name: string): void {
  const timer = worktreeRetryTimers.get(name)
  if (timer) clearTimeout(timer)
  worktreeRetryTimers.delete(name)
  worktreeRetryAttempted.delete(name)
  worktreeRetryCount.delete(name)
}

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
  let root: ExactTreeWatcherRegistry | null = null
  let index: ExactTreeWatcherRegistry | null = null
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
  root = new ExactTreeWatcherRegistry({
    root: wtPath,
    source: `worktree:${resolve(wtPath)}`,
    scope: 'full',
    ignore: ignoredWorktreePath,
    onInput: () => onInput(),
    onFailure: fail,
  })
  if (!root.refresh()) throw attachError ?? new Error(`spec-cli: graph watcher 'worktree' failed at ${wtPath}`)
  index = new ExactTreeWatcherRegistry({
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
  // Failure/overflow has no trustworthy path. Keep last-known, mark the target updating, and immediately
  // resubscribe; the authorized summary build is the one authoritative rescan, never a periodic sweep.
  dropWorktreeWatcher(name)
  console.error(error.message)
  if (holdSessionEvalProjectionObserver(worktreeObserver(name), { path })) fireChanged('full')
  scheduleWorktreeRetry(name)
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
      clearWorktreeRetry(e.name)
      continue
    }
    wantedNames.add(e.name)
    const existing = worktreeWatchers.get(e.name)
    if (existing?.path === normalizedPath) continue
    const rootChanged = existing != null
    if (existing) { dropWorktreeWatcher(e.name); clearWorktreeRetry(e.name) }
    if (worktreeRetryAttempted.has(e.name)) continue
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
      clearWorktreeRetry(e.name)
      if (rootChanged) fireChanged('full', { path: wtPath })
      // The replacement is live before its hold is removed. This delta authorizes one double-read rescan,
      // so edits made anywhere in the unwatched interval are inside the new generation's fingerprint.
      if (releaseSessionEvalProjectionObserver(worktreeObserver(e.name))) fireChanged('full')
    } catch (error) {
      // An attach failure is observable: mark unknown/full now. The next registry change or explicit graph
      // source setup retries; no patrol is allowed to call the eval projection current.
      console.error(error instanceof Error ? error.message : String(error))
      if (holdSessionEvalProjectionObserver(worktreeObserver(e.name), { path: wtPath })) fireChanged('full')
      scheduleWorktreeRetry(e.name)
    }
  }
  for (const name of worktreeWatchers.keys()) if (!wantedNames.has(name)) {
    dropWorktreeWatcher(name)
    released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
  }
  for (const name of worktreeRetryCount.keys()) if (!wantedNames.has(name)) {
    clearWorktreeRetry(name)
    released = releaseSessionEvalProjectionObserver(worktreeObserver(name)) || released
  }
  if (released) fireChanged('full')
}

function reconcileWorktrees(forceSessionId?: string): Promise<void> {
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
): ExactTreeWatcherRegistry {
  let ready = false
  let attachError: Error | null = null
  const registry = new ExactTreeWatcherRegistry({
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

function scheduleRegistryRetry(): void {
  if (registryRetryImmediate) return
  const era = watcherEra
  registryRetryImmediate = setImmediate(() => {
    registryRetryImmediate = null
    if (era !== watcherEra) return
    registryReady = false
    void ensureWorktreeRegistry(false)
  })
  registryRetryImmediate.unref?.()
}

function registryWatcherFailed(error: Error): void {
  registryWatcher = null
  console.error(error.message)
  if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
  scheduleRegistryRetry()
}

async function ensureWorktreeRegistry(retry = true, forceSessionId?: string): Promise<void> {
  const common = activeCommonRoot
  if (!common) return
  const dir = resolve(join(common, 'worktrees'))
  // The registry watcher already reconciles add/remove events. Re-scanning every ordinary graph/evals read
  // turns a large worktree registry into an artificial request latency floor; only a scoped read may demand
  // one target after startup, while the unscoped hot path reuses the attached live watchers.
  if (registryWatcher?.root === dir) {
    if (forceSessionId) await reconcileWorktrees(forceSessionId)
    return
  }
  if (registryWatcher) { registryWatcher.close(); registryWatcher = null; registryReady = false }
  // A platform may reject registry watches. Once the initial reconciliation has run, ordinary
  // reads must not repeat its full worktree scan while the one scheduled retry is pending; scoped reads can
  // still demand their target explicitly.
  if (registryReady && !forceSessionId) return
  if (registryReady && forceSessionId) { await reconcileWorktrees(forceSessionId); return }
  registryReady = true
  if (isDisabled('worktrees')) {
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
    return
  }
  try {
    try { mkdirSync(dir, { recursive: true }) }
    catch (error) { console.error(`spec-cli: graph watcher 'worktree-registry' could not create ${dir}: ${error instanceof Error ? error.message : String(error)}`) }
    // a registry add/remove is itself a 'full' change (a new/gone worktree reshapes the overlay); also
    // reconcile the per-worktree `.spec` watchers on every registry event.
    registryWatcher = watchSessionEvalRegistry(dir, () => {
      void reconcileWorktrees()
      fireChanged('full', 'all')
    }, registryWatcherFailed)
  } catch (error) {
    registryWatcher = null
    console.error(error instanceof Error ? error.message : String(error))
    if (holdSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER, 'all')) fireChanged('full')
    if (retry) scheduleRegistryRetry()
  }
  await reconcileWorktrees(forceSessionId)   // attach for the live/demanded worktrees that already exist
  if (registryWatcher && releaseSessionEvalProjectionObserver(WORKTREE_REGISTRY_OBSERVER)) fireChanged('full')
}

// Attach the canonical filesystem sources before an HTTP snapshot starts summary work. This closes the
// request→SSE handoff gap: an edit after the snapshot build has a watcher before it can occur.
export async function ensureBoardFileWatchers(forceSessionId?: string): Promise<void> {
  const storeRoot = resolve(sessionsRoot())
  const commonRoot = resolve(gitCommonDir())
  if ((activeStoreRoot && activeStoreRoot !== storeRoot) || (activeCommonRoot && activeCommonRoot !== commonRoot))
    closeBoardFileWatchers()
  activeStoreRoot = storeRoot
  activeCommonRoot = commonRoot
  ensureWatcher(storeRoot)
  ensureRefsWatcher(true, commonRoot)
  await ensureWorktreeRegistry(true, forceSessionId)
}

export function closeBoardFileWatchers(): void {
  watcherEra++
  if (storeRetryImmediate) { clearImmediate(storeRetryImmediate); storeRetryImmediate = null }
  if (refsRetryImmediate) { clearImmediate(refsRetryImmediate); refsRetryImmediate = null }
  if (registryRetryImmediate) { clearImmediate(registryRetryImmediate); registryRetryImmediate = null }
  for (const timer of worktreeRetryTimers.values()) clearTimeout(timer)
  worktreeRetryTimers.clear()
  worktreeRetryAttempted.clear()
  worktreeRetryCount.clear()
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
