import { buildBoard, spliceSessions } from './graph.js'
import { withGitAbortSignal } from './git.js'

// @@@ graph-cache — single-flight + cache for the hot /api/graph build ([[graph-lean]]). Assembling the
// board is expensive (two full-history git-log walks cold, a full `.spec` fs walk every build), so the
// route MUST NOT rebuild per request: index.ts once ran `buildBoard()` inline on EVERY poll, so a normal
// dashboard's overlapping polls (+ SSE-triggered refetches) multiplied into N simultaneous builds and
// starved the event loop — one real user could wedge the backend. Here ONE build is shared by all
// concurrent callers (a promise memo — this IS the max-concurrent-builds cap: at most one runs) and its
// result is cached until a REAL change invalidates it. The cache is invalidated by the SAME freshness
// signals [[graph-stream]] already watches (session-store writes, git-ref moves, the cold tick), via
// invalidateBoard(). So a poll storm costs ONE build, a quiet stretch costs ZERO, and the SSE rebuild and
// the route share the very same in-flight build.

export type Board = Awaited<ReturnType<typeof buildBoard>>
export type BoardConsistency = 'fresh' | 'stale-ok'
export type BoardRead = { board: Board; freshness: 'fresh' | 'stale'; refreshing: boolean; error?: string }
export type BoardJsonRead = BoardRead & { json: string }

// a build slower than this is LOGGED, never silently tolerated — the fail-loud regression alarm. Sized
// above a warm build (~sub-second once the fs walks yield) but below the cold two-walk first build, so a
// genuinely-degraded hot path shouts while an ordinary cold start stays quiet-ish.
const BUDGET_MS = Number(process.env.SPEXCODE_BOARD_BUDGET_MS || 1500)

// a build that NEVER settles is a different animal from a slow one: `inflight` clears only in the finally
// below, so a never-settling buildBoard() would pin the single-flight forever — every later read (even of a
// perfectly good cached board) short-circuits into the pinned promise before `valid` is consulted,
// invalidation can't help, no log ever fires, and only a restart cures it (the live wedge: hung git
// children → /api/graph 503 forever, silently). So the build races a generous watchdog that REJECTS loudly;
// the rejection flows through the SAME finally → inflight clears → the next read retries fresh. Sitting at
// the single-flight boundary, this one wall bounds every never-settle cause — including ones with no child
// process at all (fs/promises under libuv threadpool starvation); git.ts's per-child timeouts merely make
// the common cause die sooner. Generous: well above the slowest legitimate cold build, so it only ever
// fires on a genuine wedge.
const BUILD_TIMEOUT_MS = Number(process.env.SPEXCODE_BOARD_BUILD_TIMEOUT_MS || 120000)
const RETRY_BACKOFF_MS = Number(process.env.SPEXCODE_BOARD_RETRY_BACKOFF_MS || 1000)

// the cache's staleness has a DOMAIN, not just a bit: a 'sessions' change (a lifecycle write, a
// liveness/activity poll flip) touches only the session rows, so the next read can SPLICE fresh sessions
// onto the still-valid node/meta units instead of re-walking git+`.spec`; a 'full' change (a ref move, a
// worktree `.spec` edit, the cold-tick patrol) can reshape anything, so the next read does the whole
// buildBoard(). 'none' = clean.
type Scope = 'sessions' | 'full'
let cached: Board | null = null   // last completed build; served while `dirty === 'none'`
let cachedJson: string | null = null   // JSON.stringify(cached), serialized ONCE per build (see getBoardJson)
let dirty: Scope | 'none' = 'full'   // no cached board yet → the first read builds fully
type Flight = { wait: Promise<Board>; settle: Promise<Board> }
let inflight: Flight | null = null
let gen = 0                       // bumped on every invalidation — detects a change that landed MID-build
let retryAt = 0
let lastFailure: Error | null = null

// mark the cache stale at a SCOPE. Called by every board-stream freshness source (see
// boardStream.fireChanged), so a real change forces the next getBoard() to rebuild while a quiet poll storm
// keeps hitting the cache. The scope only ESCALATES within a dirty window: none→sessions→full, and a
// 'sessions' signal arriving while 'full' is already pending stays 'full' (a full rebuild subsumes a
// sessions splice). The last-good JSON stays intact while dirty so stale readers can return it without
// paying serialization again; a successful replacement clears it.
export function invalidateBoard(scope: Scope = 'full'): void {
  gen++
  if (scope === 'full' || dirty === 'full') dirty = 'full'
  else dirty = 'sessions'
  retryAt = 0
  lastFailure = null
}

// the coalesced board read the route and the SSE rebuild both go through. A concurrent caller during a
// build shares the in-flight promise; a caller after a completed build gets the cached value until the
// next invalidation. A 'sessions'-scoped dirty with a cached board takes the SPLICE path (spliceSessions —
// fresh session rows onto the cached node/meta units) under the SAME single-flight promise + watchdog +
// generation rules; anything else (dirty 'full', or no cache to splice onto) does a full buildBoard(). A
// change that lands WHILE a build runs (gen moved) leaves the cache dirty so the NEXT read rebuilds — a
// 'full' invalidation landing mid-splice leaves it dirty 'full' for the next read. The just-finished build
// still returns to its waiters (freshest available when they asked), never cached as current. Mirrors
// [[graph-stream]]'s building/dirty loop.
function startBuild(): Flight | null {
  if (inflight) return inflight
  if (Date.now() < retryAt) return null
  const startGen = gen
  const sessionsOnly = dirty === 'sessions' && cached !== null
  const prev = cached
  const controller = new AbortController()
  const t0 = Date.now()
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const build = withGitAbortSignal(controller.signal, () => sessionsOnly ? spliceSessions(prev!) : buildBoard())
  const timeoutError = () => new Error(`graph build did not settle within ${BUILD_TIMEOUT_MS}ms`)

  // `settle` owns the real builder. The watchdog only rejects `wait`; the slot remains occupied until this
  // promise settles, so a next read can never overlap an abandoned git/fs build.
  let settle!: Promise<Board>
  settle = build.then((board) => {
    if (timedOut) throw timeoutError()
    cached = board
    cachedJson = null
    if (gen === startGen) dirty = 'none'
    retryAt = 0
    lastFailure = null
    return board
  }).catch((error) => {
    const failure = error instanceof Error ? error : new Error(String(error))
    lastFailure = failure
    retryAt = Date.now() + RETRY_BACKOFF_MS
    console.warn(`spec-cli: /api/graph build failed — ${failure.message}`)
    throw failure
  }).finally(() => {
    clearTimeout(watchdog)
    if (inflight?.settle === settle) inflight = null
    const ms = Date.now() - t0
    if (ms > BUDGET_MS)
      console.warn(`spec-cli: /api/graph build took ${ms}ms (budget ${BUDGET_MS}ms) — hot path is slow`)
  })

  const wait = new Promise<Board>((resolve, reject) => {
    watchdog = setTimeout(() => {
      timedOut = true
      console.warn(`spec-cli: /api/graph build did not settle within ${BUILD_TIMEOUT_MS}ms — aborting the single-flight build`)
      controller.abort()
      reject(timeoutError())
    }, BUILD_TIMEOUT_MS)
    watchdog.unref?.()
    build.then((board) => {
      if (!timedOut) resolve(board)
    }, (error) => {
      if (!timedOut) reject(error)
    })
  })
  const flight = { wait, settle }
  inflight = flight
  // Background stale readers intentionally do not await these promises. Observe both rejection paths so a
  // failed build is loud without becoming an unhandled rejection.
  void wait.catch(() => {})
  void settle.catch(() => {})
  return flight
}

export function getBoard(): Promise<Board> {
  if (dirty === 'none' && cached) return Promise.resolve(cached)
  const flight = startBuild()
  if (flight) return flight.wait
  return Promise.reject(lastFailure ?? new Error('graph build retry is temporarily backing off'))
}

export async function readBoard(consistency: BoardConsistency = 'fresh'): Promise<BoardRead> {
  if (consistency === 'stale-ok' && cached) {
    const stale = dirty !== 'none'
    const flight = stale ? startBuild() : null
    return { board: cached, freshness: stale ? 'stale' : 'fresh', refreshing: !!flight, ...(lastFailure ? { error: lastFailure.message } : {}) }
  }
  const board = await getBoard()
  return { board, freshness: 'fresh', refreshing: false }
}

// the SERIALIZED board for the /api/graph route — JSON.stringify runs ONCE per build, not once per poll,
// so a poll storm of cache hits costs zero serialization CPU (only the etag hash for the 304 path). The SSE
// path still takes the object (getBoard) because it decomposes it into delta units ([[graph-delta]]).
export async function getBoardJson(consistency: BoardConsistency = 'fresh'): Promise<BoardJsonRead> {
  const result = await readBoard(consistency)
  const board = result.board
  if (board === cached && cachedJson !== null) return { ...result, json: cachedJson }
  const json = JSON.stringify(board)
  if (board === cached) cachedJson = json   // memoize only the CURRENT build's serialization
  return { ...result, json }
}
