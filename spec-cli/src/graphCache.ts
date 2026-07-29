import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { buildBoard, rebasePublishedSessions, spliceSessions } from './graph.js'
import { headSha, repoRoot, withGitAbortSignal } from './git.js'
import { listSessionIds, mainBranch, mainCheckout, readPublicRecordEntry, sessionArtifactPath, sessionRecordPath } from './layout.js'
import { boardThreads } from './issues.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { residentForgeState } from '../../spec-forge/src/resident.js'
import { resolveProjectIdentity } from './project-identity.js'
import { sessionEvalProjection } from '../../spec-eval/src/sessioneval.js'

export type Board = Awaited<ReturnType<typeof buildBoard>>
export type BoardConsistency = 'fresh' | 'stale-ok'
export type BoardRead = { board: Board; freshness: 'fresh' | 'stale'; refreshing: boolean; error?: string }
export type BoardJsonRead = BoardRead & { json: string }

type BoardInputRevision = {
  full: string
  sessions: string
  projections: string
  combined: string
  fullParts: Record<string, string>
  projectionIds: string[]
}
type SessionInputRevision = Pick<BoardInputRevision, 'sessions' | 'projections' | 'projectionIds'>
const DEBUG = process.env.SPEXCODE_BOARD_DEBUG === '1'

function textOrNull(path: string): string | null {
  try { return readFileSync(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function gitDirOf(root: string): string {
  const dotgit = join(root, '.git')
  try { if (statSync(dotgit).isDirectory()) return dotgit }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  const dotgitText = textOrNull(dotgit)
  if (dotgitText === null) return ''
  const match = dotgitText.match(/^gitdir:\s*(.+)$/m)
  if (!match) throw new Error(`unparseable gitdir pointer at ${dotgit}`)
  const dir = match[1].trim()
  return isAbsolute(dir) ? dir : resolve(root, dir)
}

function commonDirOf(root: string): string {
  const gitDir = gitDirOf(root)
  if (!gitDir) return ''
  const common = textOrNull(join(gitDir, 'commondir'))
  if (common === null) return gitDir
  const dir = common.trim()
  if (!dir) throw new Error(`empty commondir pointer at ${join(gitDir, 'commondir')}`)
  return isAbsolute(dir) ? dir : resolve(gitDir, dir)
}

function refSha(root: string, ref: string): string {
  if (/^[0-9a-f]{40}$/.test(ref)) return ref
  const common = commonDirOf(root)
  if (!common) return '<missing>'
  const names = ref.startsWith('refs/') ? [ref] : [`refs/heads/${ref}`, `refs/remotes/${ref}`]
  for (const name of names) {
    const loose = textOrNull(join(common, name))
    if (loose !== null) return loose.trim() || '<missing>'
  }
  const packed = textOrNull(join(common, 'packed-refs'))
  if (packed !== null) {
    for (const line of packed.split('\n')) {
      if (!line || line[0] === '#' || line[0] === '^') continue
      const space = line.indexOf(' ')
      if (space > 0 && names.includes(line.slice(space + 1).trim())) return line.slice(0, space).trim()
    }
  }
  return '<missing>'
}

function headRevision(root: string): string {
  if (!gitDirOf(root)) return '<missing>'
  return headSha(root)
}

// Patrol validation needs a stronger contract than the overlay cache's best-effort mtime key: ctime catches
// a same-size edit whose mtime was restored, and every non-ENOENT read failure is loud instead of collapsing an
// unreadable subtree into a stable "unchanged" revision. A path that vanishes during the sample is represented
// by its absence and is rechecked by the producer fence.
function strictSpecTreeRevision(wtPath: string): string {
  const root = join(wtPath, '.spec')
  try { statSync(root) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
  const parts: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      continue
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { stack.push(path); continue }
      try {
        const stat = statSync(path)
        parts.push(`${path}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return parts.sort().join('\n')
}

function worktreeRevision(root: string): unknown {
  return {
    root,
    head: headRevision(root),
    spec: strictSpecTreeRevision(root),
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// The patrol's cheap authority check. These are exactly the mutable inputs a board assembly reads, folded
// without doing the assembly: HEAD/config + `.spec`, governed records and active governed worktree state,
// the issue-store carrier, and the already-resident session-eval projections. It intentionally does not call
// listSessions or sessionEvalProjections: verification must neither poll tmux again nor mint/schedule eval work.
// The hot/warm liveness signatures and eval generations remain graph-stream's canonical event-owned axes.
function sessionInputRevision(): SessionInputRevision {
  const ids = listSessionIds().sort()
  // listSessions projects both the structured record and the separately-stored originating prompt into each
  // board row. Fold both exact artifacts so a missed store event cannot leave a stale label/prompt forever.
  const sessionInputs = ids.map((id) => [
    id,
    textOrNull(sessionRecordPath(id)),
    textOrNull(sessionArtifactPath(id, 'prompt')),
  ] as const)
  const projections = digest(ids.map((id) => [id, sessionEvalProjection(id)]))
  return { sessions: digest(sessionInputs), projections, projectionIds: ids }
}

function boardInputRevision(board: Board | null): BoardInputRevision {
  const root = repoRoot()
  const session = sessionInputRevision()
  const records = listSessionIds().map(readPublicRecordEntry).flatMap((entry) => entry.kind === 'ok' ? [entry.raw] : [])
  const governed = records.filter((record) => record.governed).sort((a, b) => a.session_id.localeCompare(b.session_id))
  const activeRoots = [...new Set(governed.filter((record) => !record.archived).map((record) => record.worktree_path))].sort()
  const main = mainCheckout()
  const base = mainBranch()
  const mainTip = refSha(main, base)
  const nodeIds = (board?.nodes ?? []).map((node) => node.id)
  const issuesStamp = boardThreads({ host: resolveForgeHost(), state: residentForgeState() }, nodeIds).stamp
  const fullInputs = {
    root: worktreeRevision(root),
    config: [
      [join(root, 'spexcode.json'), textOrNull(join(root, 'spexcode.json'))],
      [join(root, 'spexcode.local.json'), textOrNull(join(root, 'spexcode.local.json'))],
      [join(main, 'spexcode.json'), textOrNull(join(main, 'spexcode.json'))],
      [join(main, 'spexcode.local.json'), textOrNull(join(main, 'spexcode.local.json'))],
    ],
    main: { root: main, branch: base, tip: mainTip },
    worktrees: activeRoots.map((worktree) => worktreeRevision(worktree)),
    issuesStamp,
    identity: resolveProjectIdentity(root, root),
  }
  const fullParts = Object.fromEntries(Object.entries(fullInputs).map(([key, value]) => [key, digest(value)]))
  const full = digest(fullParts)
  return {
    full,
    ...session,
    combined: digest([full, session.sessions, session.projections]),
    fullParts,
  }
}

// Bind an input sample to what the completed board actually carries. The sample supplies the graph/session
// revision observed immediately after the producer; issue and projection values come from the returned board
// itself. Re-reading all inputs here would create a certification race: a blind change after the producer's
// after-sample could otherwise be mistaken for an input the already-built board contains.
function revisionCarriedByBoard(sample: BoardInputRevision, board: Board): BoardInputRevision {
  const fullParts = { ...sample.fullParts, issuesStamp: digest(board.issuesStamp) }
  const full = digest(fullParts)
  const boardProjections = new Map(board.sessions.map((session) => [session.id, session.evalSummary ?? null]))
  const projections = digest(sample.projectionIds.map((id) => [id, boardProjections.get(id) ?? null]))
  return {
    full,
    sessions: sample.sessions,
    projections,
    combined: digest([full, sample.sessions, projections]),
    fullParts,
    projectionIds: sample.projectionIds,
  }
}

// A sessions splice reuses its base topology. It may sample fresh record/projection inputs, but it must never
// certify that those old nodes carry a full revision sampled after the base was built.
function revisionCarriedBySessionSplice(base: BoardInputRevision, sample: SessionInputRevision, board: Board, stable: boolean): BoardInputRevision {
  const boardProjections = new Map(board.sessions.map((session) => [session.id, session.evalSummary ?? null]))
  const projections = stable
    ? digest(sample.projectionIds.map((id) => [id, boardProjections.get(id) ?? null]))
    : sample.projections
  return {
    full: base.full,
    sessions: sample.sessions,
    projections,
    combined: digest([base.full, sample.sessions, projections]),
    fullParts: base.fullParts,
    projectionIds: sample.projectionIds,
  }
}

// The full producer's topology may be newer than the last published session projection. When completion
// re-bases that already-visible projection onto the new topology, keep the full carrier from the producer and
// only the sessions/projections carrier from the published rows. Do not sample current inputs here: that would
// certify a write that neither producer actually carried.
function revisionCarriedByPublishedSessionRebase(full: BoardInputRevision, published: BoardInputRevision): BoardInputRevision {
  return {
    full: full.full,
    sessions: published.sessions,
    projections: published.projections,
    combined: digest([full.full, published.sessions, published.projections]),
    fullParts: full.fullParts,
    projectionIds: published.projectionIds,
  }
}

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
const BACKGROUND_START_DELAY_MS = Number(process.env.SPEXCODE_BOARD_BACKGROUND_START_DELAY_MS || 300)

// The structural/full and sessions obligations are deliberately separate. A full build can take seconds;
// a persisted session row cannot be silently converted into time behind that unrelated topology work.
type Scope = 'sessions' | 'full'
let cached: Board | null = null   // last completed build; served while `dirty === 'none'`
let cachedJson: string | null = null   // JSON.stringify(cached), serialized ONCE per build (see getBoardJson)
let cachedRevision: BoardInputRevision | null = null // input revision represented by `cached`
let dirty: Scope | 'none' = 'full'   // no cached board yet → the first read builds fully
type Flight = { wait: Promise<Board>; settle: Promise<Board> }
let inflight: Flight | null = null
let sessionFlight: Flight | null = null
let sessionOwed = false
let sessionGeneration = 0
let sessionProjectionPublication = 0
let topologyGeneration = 0
let gen = 0                       // bumped on invalidation so patrol validation cannot certify across an event
let retryAt = 0
let lastFailure: Error | null = null

// mark the cache stale at a SCOPE. Called by every board-stream freshness source (see
// boardStream.fireChanged), so a real change forces the next getBoard() to rebuild while a quiet poll storm
// keeps hitting the cache. `dirty` is the structural producer's scope; `sessionOwed` is intentionally not
// folded into it, because full+sessions owes both a full convergence and a cheap first projection.
function mergeDirty(scope: Scope): void {
  if (scope === 'full' || dirty === 'full') dirty = 'full'
  else dirty = 'sessions'
}

export function invalidateBoard(scope: Scope = 'full'): void {
  gen++
  if (scope === 'sessions') { sessionOwed = true; sessionGeneration++ }
  mergeDirty(scope)
  retryAt = 0
  lastFailure = null
}

function startSessionSplice(): Flight | null {
  if (!cached || !cachedRevision || !sessionOwed) return null
  if (sessionFlight) return sessionFlight
  sessionOwed = false
  if (dirty === 'sessions') dirty = 'none'
  let timedOut = false
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const timeoutError = () => new Error(`graph session splice did not settle within ${BUILD_TIMEOUT_MS}ms`)
  const producer = Promise.resolve().then(async () => {
    // A full completion may replace the topology while listSessions is in flight. Rebase before publishing;
    // the splice is a projection over whatever last-good structure is current, never a whole-board write race.
    while (true) {
      const base = cached, revision = cachedRevision, generation = topologyGeneration
      if (!base || !revision) throw new Error('graph session splice lost its cached topology')
      const before = sessionInputRevision()
      const board = await spliceSessions(base)
      const after = sessionInputRevision()
      if (base !== cached || revision !== cachedRevision || generation !== topologyGeneration) continue
      const stable = before.sessions === after.sessions && before.projections === after.projections
      cached = board
      cachedJson = null
      cachedRevision = revisionCarriedBySessionSplice(revision, before, board, stable)
      sessionProjectionPublication++
      if (!stable) {
        sessionOwed = true
        sessionGeneration++
        mergeDirty('sessions')
      }
      return board
    }
  })
    .then((board) => {
      if (timedOut) throw timeoutError()
      return board
    })
    .catch((error) => {
      sessionOwed = true
      mergeDirty('sessions')
      throw error
    })
  let settle!: Promise<Board>
  settle = producer.finally(() => {
    clearTimeout(watchdog)
    if (sessionFlight?.settle === settle) sessionFlight = null
  })
  const wait = new Promise<Board>((resolve, reject) => {
    watchdog = setTimeout(() => {
      timedOut = true
      console.warn(`spec-cli: graph session splice did not settle within ${BUILD_TIMEOUT_MS}ms`)
      reject(timeoutError())
    }, BUILD_TIMEOUT_MS)
    watchdog.unref?.()
    settle.then((board) => { if (!timedOut) resolve(board) }, (error) => { if (!timedOut) reject(error) })
  })
  const flight = { wait, settle }
  sessionFlight = flight
  void wait.catch(() => {})
  void settle.catch(() => {})
  return flight
}

// One flight owns BOTH patrol validation and a producer. A patrol first folds the cheap input revision; an
// exact match resolves to `cached` without calling either producer. A mismatch derives the changed domain and
// falls through to the same build path an explicit watcher invalidation takes. An invalidation during validation
// also falls through under this flight, so validation can never race a second producer into existence.
type FlightMode = 'dirty' | 'patrol'
function startBuild(mode: FlightMode = 'dirty'): Flight | null {
  if (inflight) return inflight
  if (Date.now() < retryAt) return null
  const flightStartGen = gen
  const controller = new AbortController()
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let built = false
  let buildStartedAt = 0
  let buildScope: Scope = 'full'
  let buildFullStable = true
  let buildSessionsStable = true
  let buildSessionGeneration = sessionGeneration
  let buildSessionProjectionPublication = sessionProjectionPublication
  let buildStartedWithSessionOwed = false
  let completedRevision: BoardInputRevision | null = null
  // Do not invoke the producer inline. buildBoard() has an asynchronous signature but performs a sizeable
  // synchronous setup before its first await (Promise.all evaluates its arguments immediately). A stale HTTP
  // caller must be able to return its last-good bytes before that setup runs; first-cold/fresh callers still
  // await the same deferred promise below.
  let resolveBuild!: (board: Board) => void
  let rejectBuild!: (error: unknown) => void
  const build = new Promise<Board>((resolve, reject) => {
    resolveBuild = resolve
    rejectBuild = reject
  })
  // Give a stale HTTP response a turn to flush before the producer's synchronous setup occupies the event
  // loop. Fresh callers simply absorb this small scheduling window while waiting on the same flight.
  setTimeout(() => {
    if (controller.signal.aborted) {
      rejectBuild(Object.assign(new Error('graph build aborted before start'), { name: 'AbortError' }))
      return
    }
    try {
      Promise.resolve(withGitAbortSignal(controller.signal, async () => {
        if (mode === 'patrol' && dirty === 'none' && cached && cachedRevision) {
          const anchorRevision = cachedRevision
          const observed = await boardInputRevision(cached)
          if (controller.signal.aborted)
            throw Object.assign(new Error('graph patrol aborted'), { name: 'AbortError' })
          if (gen === flightStartGen && dirty === 'none' && observed.combined === anchorRevision.combined)
            return cached
          // A changed revision with no watcher event is the patrol doing its repair job. If an explicit event
          // arrived meanwhile it already set the correct (possibly sessions-only) scope, which we must not
          // overwrite. An otherwise-clean mismatch derives its scope from the moved input domain.
          if (gen === flightStartGen && dirty === 'none') {
            gen++
            if (DEBUG) {
              const moved = Object.keys(observed.fullParts)
                .filter((key) => observed.fullParts[key] !== anchorRevision.fullParts[key])
              console.warn(`spec-cli: graph patrol revision moved — scope=${observed.full === anchorRevision.full ? 'sessions' : 'full'} inputs=[${moved.join(', ')}]`)
          }
            if (observed.full === anchorRevision.full) {
              dirty = 'sessions'
              sessionOwed = true
              sessionGeneration++
            } else dirty = 'full'
          }
        }

        const prev = cached
        const before = await boardInputRevision(prev)
        if (controller.signal.aborted)
          throw Object.assign(new Error('graph build aborted before producer start'), { name: 'AbortError' })
        // A session signal cannot vouch for the graph domain. Before splicing, compare the current full inputs
        // to the revision the cached node/meta units actually carry; a missed graph watcher promotes this same
        // flight to full instead of certifying old nodes under a new revision.
        if (dirty === 'sessions' && prev && cachedRevision && before.full !== cachedRevision.full) {
          if (DEBUG) console.warn('spec-cli: session refresh found moved graph inputs — promoting to full')
          dirty = 'full'
        }
        const sessionsOnly = dirty === 'sessions' && prev !== null
        buildScope = sessionsOnly ? 'sessions' : 'full'
        // Consume the scope this producer is satisfying. Invalidation after this point starts a NEW dirty
        // window with its own domain: a session completion during a long full build owes one splice, not
        // another full build. The occupied `inflight` slot keeps fresh/stale readers joined while dirty is clean.
        dirty = 'none'
        if (sessionsOnly) sessionOwed = false
        built = true
        buildSessionGeneration = sessionGeneration
        buildSessionProjectionPublication = sessionProjectionPublication
        buildStartedWithSessionOwed = sessionOwed
        buildStartedAt = Date.now()
        const board = await (sessionsOnly ? spliceSessions(prev!) : buildBoard())
        const after = await boardInputRevision(prev)
        const carried = revisionCarriedByBoard(after, board)
        const movedFull = Object.keys(after.fullParts)
          .filter((key) => after.fullParts[key] !== before.fullParts[key])
        // The first build can initialize the resident forge carrier that it then returns. That movement is
        // stable only when the finished board carries the after-sample's exact issue stamp. Every other cold
        // movement remains dirty just like a warm one; cold start is not a blanket race exemption.
        const coldIssueInitialization = prev === null
          && movedFull.every((key) => key === 'issuesStamp')
          && after.fullParts.issuesStamp === carried.fullParts.issuesStamp
        buildFullStable = before.full === after.full || coldIssueInitialization
        buildSessionsStable = before.sessions === after.sessions
        if (DEBUG && (!buildFullStable || !buildSessionsStable)) {
          console.warn(`spec-cli: graph inputs moved during ${buildScope} producer — next=${buildFullStable ? 'sessions' : 'full'} inputs=[${movedFull.join(', ')}] sessions=${buildSessionsStable ? 'stable' : 'moved'}`)
        }
        completedRevision = carried
        return board
      }))
        .then(resolveBuild, rejectBuild)
    } catch (error) {
      rejectBuild(error)
    }
  }, mode === 'patrol' ? 0 : BACKGROUND_START_DELAY_MS).unref?.()
  const timeoutError = () => new Error(`graph build did not settle within ${BUILD_TIMEOUT_MS}ms`)

  // `settle` owns the real builder. The watchdog only rejects `wait`; the slot remains occupied until this
  // promise settles, so a next read can never overlap an abandoned git/fs build.
  let settle!: Promise<Board>
  settle = build.then(async (board) => {
    if (timedOut) throw timeoutError()
    if (built) {
      // A full build's session snapshot may predate a session projection that clients already saw. Rebase those
      // published rows in memory on the new topology. This completion path must stay bounded: a later/unpublished
      // session generation remains owed to the independent cheap splice rather than making full wait for quiet.
      const publishedDuringBuild = sessionProjectionPublication !== buildSessionProjectionPublication
      if (buildScope === 'full' && publishedDuringBuild && cached && cachedRevision) {
        board = rebasePublishedSessions(board, cached)
        completedRevision = revisionCarriedByPublishedSessionRebase(completedRevision!, cachedRevision)
      }
      const sessionStillOwed = sessionOwed || (!publishedDuringBuild && (
        buildStartedWithSessionOwed || !buildSessionsStable || buildSessionGeneration !== sessionGeneration
      ))
      if (sessionStillOwed) {
        sessionOwed = true
        mergeDirty('sessions')
      }
      cached = board
      cachedJson = null
      cachedRevision = completedRevision
      if (buildScope === 'full') topologyGeneration++
      else sessionProjectionPublication++
      if (!buildFullStable) mergeDirty('full')
    }
    retryAt = 0
    lastFailure = null
    return board
  }).catch((error) => {
    const failure = error instanceof Error ? error : new Error(String(error))
    if (built) mergeDirty(buildScope)
    lastFailure = failure
    retryAt = Date.now() + RETRY_BACKOFF_MS
    console.warn(`spec-cli: /api/graph build failed — ${failure.message}`)
    throw failure
  }).finally(() => {
    clearTimeout(watchdog)
    if (inflight?.settle === settle) inflight = null
    const ms = built ? Date.now() - buildStartedAt : 0
    if (built && ms > BUDGET_MS)
      console.warn(`spec-cli: /api/graph build took ${ms}ms (budget ${BUDGET_MS}ms) — ${buildScope} path is slow`)
  })

  const wait = new Promise<Board>((resolve, reject) => {
    watchdog = setTimeout(() => {
      timedOut = true
      console.warn(`spec-cli: /api/graph build did not settle within ${BUILD_TIMEOUT_MS}ms — aborting the single-flight build`)
      controller.abort()
      reject(timeoutError())
    }, BUILD_TIMEOUT_MS)
    watchdog.unref?.()
    settle.then((board) => {
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
  // A clean-looking cache can be under patrol validation. Fresh readers join that flight before taking the
  // cache fast path, otherwise one can return stale bytes while the flight is discovering a missed change.
  if (inflight) return inflight.wait
  if (dirty === 'full') {
    const flight = startBuild('dirty')
    if (flight) return flight.wait
  }
  if (sessionFlight) return sessionFlight.wait
  if (dirty === 'none' && cached) return Promise.resolve(cached)
  const flight = startBuild('dirty')
  if (flight) return flight.wait
  return Promise.reject(lastFailure ?? new Error('graph build retry is temporarily backing off'))
}

// Delta delivery may choose the sessions obligation while a route-owned full is still in flight. Starting
// the full first preserves structural convergence; returning the splice first keeps the lifecycle surface live.
export function getBoardForSessionRefresh(): Promise<Board> {
  if (cached && sessionOwed) {
    if (!inflight && dirty === 'full') startBuild('dirty')
    const flight = startSessionSplice()
    if (flight) return flight.wait
  }
  return getBoard()
}

// The delta-gated cold tick calls this instead of invalidating. Equal inputs resolve to the cached object;
// changed inputs repair through the same flight and full producer as a watcher-owned invalidation.
export function patrolBoard(): Promise<Board> {
  if (!cached) return getBoard()
  const flight = startBuild('patrol')
  if (flight) return flight.wait
  return Promise.reject(lastFailure ?? new Error('graph patrol retry is temporarily backing off'))
}

export async function readBoard(consistency: BoardConsistency = 'fresh'): Promise<BoardRead> {
  if (consistency === 'stale-ok' && cached) {
    const stale = dirty !== 'none' || inflight !== null || sessionFlight !== null || sessionOwed
    // A held session splice already owns this refresh. Returning stale bytes must not manufacture a full
    // producer beside it; a real full obligation still starts its one structural producer independently.
    const flight = inflight
      ?? (dirty === 'full' ? startBuild('dirty') : null)
      ?? sessionFlight
      ?? (sessionOwed ? startSessionSplice() : null)
      ?? (dirty === 'sessions' ? startBuild('dirty') : null)
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
