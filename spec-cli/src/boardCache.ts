import { buildBoard } from './board.js'

// @@@ board-cache — single-flight + cache for the hot /api/board build ([[board-lean]]). Assembling the
// board is expensive (two full-history git-log walks cold, a full `.spec` fs walk every build), so the
// route MUST NOT rebuild per request: index.ts once ran `buildBoard()` inline on EVERY poll, so a normal
// dashboard's overlapping polls (+ SSE-triggered refetches) multiplied into N simultaneous builds and
// starved the event loop — one real user could wedge the backend. Here ONE build is shared by all
// concurrent callers (a promise memo — this IS the max-concurrent-builds cap: at most one runs) and its
// result is cached until a REAL change invalidates it. The cache is invalidated by the SAME freshness
// signals [[board-stream]] already watches (session-store writes, git-ref moves, the cold tick), via
// invalidateBoard(). So a poll storm costs ONE build, a quiet stretch costs ZERO, and the SSE rebuild and
// the route share the very same in-flight build.

export type Board = Awaited<ReturnType<typeof buildBoard>>

// a build slower than this is LOGGED, never silently tolerated — the fail-loud regression alarm. Sized
// above a warm build (~sub-second once the fs walks yield) but below the cold two-walk first build, so a
// genuinely-degraded hot path shouts while an ordinary cold start stays quiet-ish.
const BUDGET_MS = Number(process.env.SPEXCODE_BOARD_BUDGET_MS || 1500)

let cached: Board | null = null   // last completed build; served while `valid`
let cachedJson: string | null = null   // JSON.stringify(cached), serialized ONCE per build (see getBoardJson)
let valid = false
let inflight: Promise<Board> | null = null
let gen = 0                       // bumped on every invalidation — detects a change that landed MID-build

// mark the cache stale. Called by every board-stream freshness source (see boardStream.fireChanged), so a
// real change forces the next getBoard() to rebuild while a quiet poll storm keeps hitting the cache.
export function invalidateBoard(): void {
  gen++
  valid = false
}

// the coalesced board read the route and the SSE rebuild both go through. A concurrent caller during a
// build shares the in-flight promise; a caller after a completed build gets the cached value until the
// next invalidation. A change that lands WHILE a build runs (gen moved) leaves the cache invalid so the
// NEXT read rebuilds — the just-finished build still returns to its waiters (freshest available when they
// asked), never cached as current. Mirrors [[board-stream]]'s building/dirty loop.
export function getBoard(): Promise<Board> {
  if (inflight) return inflight
  if (valid && cached) return Promise.resolve(cached)
  const startGen = gen
  const p = (async () => {
    const t0 = Date.now()
    try {
      const board = await buildBoard()
      cached = board
      cachedJson = null   // invalidate the memoized serialization; re-serialized lazily on first read
      valid = gen === startGen
      return board
    } finally {
      const ms = Date.now() - t0
      if (ms > BUDGET_MS) console.warn(`spec-cli: /api/board build took ${ms}ms (budget ${BUDGET_MS}ms) — hot path is slow`)
      inflight = null
    }
  })()
  inflight = p
  return p
}

// the SERIALIZED board for the /api/board route — JSON.stringify runs ONCE per build, not once per poll,
// so a poll storm of cache hits costs zero serialization CPU (only the etag hash for the 304 path). The SSE
// path still takes the object (getBoard) because it decomposes it into delta units ([[board-delta]]).
export async function getBoardJson(): Promise<string> {
  const board = await getBoard()
  if (board === cached && cachedJson !== null) return cachedJson
  const json = JSON.stringify(board)
  if (board === cached) cachedJson = json   // memoize only the CURRENT build's serialization
  return json
}
