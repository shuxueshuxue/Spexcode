import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { batchRevisionOids, gitA, gitTry, headSha, gitObjectInterpretation, currentGitBuildAbortSignal, gitAbortError, ancestorsOf, inAncestors, commitReachable, pathEvents, primeAncestorClosures, unionTopology, type DriftIndex, type DriftPathEvent, type Reachability, eventsSince } from '@spexcode/spec-core'
import { anchorHitExists, extOf, extractorFor, extractors, resolveAnchor, resolveSelectors, type AnchorHitQuery, type Extractor, type RelationEntry, type Unit } from '@spexcode/spec-core'
import type { Reading } from './sidecar.js'
import { scenarioCodeAxis, scenarioHash, type Scenario, type ScenarioCodeAxisSource } from './scenarios.js'
import { scenarioChangeCommits, scenarioBlocksAt, primeScenarioBlocks, type ScenarioIndex } from './scenariofresh.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'remark' | 'anchor'

export type ContentProbeDemand = { anchorSha: string; paths: readonly string[]; evalPath: string }

// @@@ off-history content fallback - ancestry can't testify for a codeSha that isn't reachable from HEAD
// (fold/rebase/squash-merge/cherry-pick all orphan the anchor), but the TREES still can: while the anchor
// commit object exists locally, a pathspec-scoped `git diff <anchor> HEAD -- :(literal)<path>…` answers,
// for exactly the governed paths a caller asks about, whether content differs — so a history rewrite that
// left governed content byte-identical reads FRESH instead of false-positive stale. The question is per
// REQUESTED path on purpose: one whole-repo changed-path set per anchor is what melted a production fold
// (522 anchors × ~6k retained paths ≈ 520MB of Node heap), while the verdicts actually consumed are a
// handful of governed files plus the eval.md. The probe is fed at the call sites (like the remark track) so
// the decision functions stay pure over their inputs and the in-history fast path pays no extra git call;
// only when the commit object is truly gone (gc'd orphan) does the conservative rule remain — surfaced as
// the 'anchor' axis, so "anchor lost" reads differently from "content moved". No probe fed → the old
// always-conservative rule.
export type ContentProbe = {
  // did THIS path's content change between the anchor tree and HEAD's? null = can't testify (anchor gone,
  // or the path never primed) — callers stay conservative. Only primed paths are ever retained.
  changed(anchorSha: string, path: string): boolean | null
  // content CAN testify for this anchor: the object is readable and at least one verdict has settled
  canTestify(anchorSha: string): boolean
  // did THIS scenario's semantic block (description+expected) move between anchor and HEAD ([[scenariofresh]])
  scenarioDiffers(anchorSha: string, evalPath: string, scenario: string): boolean
  // codeDrift's display detail, the half HEAD's index cannot answer: is `commit` already in the ANCHOR's own
  // past? false when the anchor's topology can't testify — the caller then counts conservatively.
  inAnchorPast(anchorSha: string, commit: string): boolean
  prime?(anchorSha: string, paths: string[], evalPath: string): Promise<void>
  primeMany?(demands: readonly ContentProbeDemand[]): Promise<void>
  // answer every scenario-block demand `prime` recorded, in ONE batched pair of children. Optional and
  // idempotent: an unflushed demand degrades to the singular sync lookup, never to a wrong block.
  primeBlocks?(): Promise<void>
}

// (anchor, HEAD) name two immutable trees, so a settled verdict never invalidates — but "never invalidates"
// is not "keep forever". A checkout answers freshness questions at ONE head at a time, so a root owns
// exactly one head's verdicts ([[source-of-truth]]'s current-root rule, the same one the history and drift
// indices follow). Keying the head into a shared memo instead made every rebuild ADD a generation: three
// full invalidations left three heads' worth of anchors resident, and the cache grew with rebuild count
// rather than with corpus size. A head move therefore swaps the root's scope atomically. An in-flight batch
// keeps the entry object its caller already holds, so that caller still settles, but a detached entry can
// never be read back through the root's current scope — an old flight cannot backfill the new head.
// An anchor entry holds only PER-REQUESTED-PATH verdicts (plus the gone bit and the batch bookkeeping),
// never a whole-repo path set.
type AnchorVerdicts = {
  imageOid: string | null | undefined // undefined = interpretation resolution is still in flight
  verdicts: Map<string, boolean>   // requested path → content differs between the two immutable trees
  gone: boolean                    // the anchor commit object is locally unreadable — content can't testify
  pending: Set<string>             // paths awaiting the next batch child
  flight: Promise<void> | null     // the single in-flight batch for this anchor
}
type RootScope = {
  head: string                         // raw HEAD + the full Git interpretation identity
  currentOid: string | null             // exact current image; null only while first resolution is in flight
  anchors: Map<string, AnchorVerdicts>
  topology: Reachability | null                // the anchors' OWN ancestry: one walk per scope, never per pair
  topologyRoster: Set<string>                  // the anchor images that walk already carries
  topologyFlight: Promise<void> | null         // the single in-flight walk
  blockDemands: Set<string>                    // (rev, evalPath) awaiting the one batched scenario-block read
  // the SELECTOR-anchor probe's verdicts, in the same scope for the same reason ([[selector-anchor-scope]]):
  // a `sinceSha..HEAD` window lengthens as HEAD advances, so these are per-head immutable, never forever
  // immutable. One scope object means one head move drops both probes' answers at once, and the cardinality
  // invariant this scope exists to hold is observable for both.
  anchorVerdicts: Map<string, boolean>
}
const rootScopes = new Map<string, RootScope>()
// Roots come and go (a closed worktree never asks again), so cap how many stay warm — the same bounded-slot
// guard the index caches use, and the only bound needed once per-root cardinality is the corpus, not history.
const ROOT_SLOTS = Math.max(4, Number(process.env.SPEXCODE_FRESHNESS_ROOT_SLOTS || 64))

function scopeFor(rootKey: string, head: string, currentOid: string | null): RootScope {
  const current = rootScopes.get(rootKey)
  if (current?.head === head && (current.currentOid === currentOid || currentOid === null || current.currentOid === null)) {
    if (currentOid !== null) current.currentOid = currentOid
    rootScopes.delete(rootKey)
    rootScopes.set(rootKey, current)
    return current
  }
  const scope: RootScope = { head, currentOid, anchors: new Map(), topology: null, topologyRoster: new Set(), topologyFlight: null, blockDemands: new Set(), anchorVerdicts: new Map() }
  rootScopes.set(rootKey, scope)
  while (rootScopes.size > ROOT_SLOTS) {
    const oldest = rootScopes.keys().next().value
    if (oldest === undefined || oldest === rootKey) break
    rootScopes.delete(oldest)
  }
  return scope
}
// a read only ever sees the root's CURRENT head — a probe pinned to a superseded head can't testify
function currentScope(rootKey: string, head: string): RootScope | undefined {
  const scope = rootScopes.get(rootKey)
  return scope?.head === head ? scope : undefined
}

// the cardinality invariant, made observable: how many anchor entries are resident at a root's CURRENT head
// (every root when none is named). It must track the corpus's anchors, never how many times the board has
// been rebuilt — one retained generation, not one per rebuild.
export function freshnessCacheSize(root?: string): number {
  if (root !== undefined) return rootScopes.get(resolve(root))?.anchors.size ?? 0
  let total = 0
  for (const scope of rootScopes.values()) total += scope.anchors.size
  return total
}

// The same invariant for the OTHER probe in this scope. It needs its own counter rather than a bigger number
// from the one above: the two hold different things (content anchor entries vs selector-anchor verdicts), and
// a counter that cannot see a case is exactly how "one retained generation, not one per rebuild" came to be
// declared, observable, and still violated ([[selector-anchor-scope]]).
export function anchorVerdictCacheSize(root?: string): number {
  if (root !== undefined) return rootScopes.get(resolve(root))?.anchorVerdicts.size ?? 0
  let total = 0
  for (const scope of rootScopes.values()) total += scope.anchorVerdicts.size
  return total
}

function touchAnchor(scope: RootScope, sha: string, imageOid: string | null | undefined): AnchorVerdicts {
  const hit = scope.anchors.get(sha)
  if (hit && imageOid === undefined) return hit
  if (hit && hit.imageOid == null && imageOid !== undefined) {
    hit.imageOid = imageOid
    hit.gone = imageOid === null
    return hit
  }
  if (hit && hit.imageOid === imageOid) return hit
  const entry: AnchorVerdicts = { imageOid, verdicts: new Map(), gone: imageOid === null, pending: new Set(), flight: null }
  scope.anchors.set(sha, entry)
  return entry
}

type HeavyDiffWaiter = {
  signal?: AbortSignal
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  onAbort: () => void
}
type HeavyDiffScope = { active: boolean; waiting: HeavyDiffWaiter[] }
const heavyDiffScopes = new Map<string, HeavyDiffScope>()

// One tree comparison at a time is enough for a production repo's pack/index memory. The graph-wide git
// permits still bound every child; this narrower domain scheduler keeps these immutable-tree
// comparisons serial per (repo, HEAD), without teaching the git transport what a content fallback is.
function acquireHeavyDiff(scopeKey: string, signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(gitAbortError())
  let scope = heavyDiffScopes.get(scopeKey)
  if (!scope) {
    scope = { active: false, waiting: [] }
    heavyDiffScopes.set(scopeKey, scope)
  }

  const releaseFor = (): (() => void) => {
    let released = false
    return () => {
      if (released) return
      released = true
      scope!.active = false
      while (scope!.waiting.length) {
        const waiter = scope!.waiting.shift()!
        waiter.signal?.removeEventListener('abort', waiter.onAbort)
        if (waiter.signal?.aborted) {
          waiter.reject(gitAbortError())
          continue
        }
        scope!.active = true
        waiter.resolve(releaseFor())
        return
      }
      if (heavyDiffScopes.get(scopeKey) === scope) heavyDiffScopes.delete(scopeKey)
    }
  }

  if (!scope.active) {
    scope.active = true
    return Promise.resolve(releaseFor())
  }
  return new Promise((resolvePermit, reject) => {
    const waiter: HeavyDiffWaiter = {
      signal,
      resolve: resolvePermit,
      reject,
      onAbort: () => {
        const index = scope!.waiting.indexOf(waiter)
        if (index < 0) return
        scope!.waiting.splice(index, 1)
        signal?.removeEventListener('abort', waiter.onAbort)
        reject(gitAbortError())
        if (!scope!.active && scope!.waiting.length === 0 && heavyDiffScopes.get(scopeKey) === scope)
          heavyDiffScopes.delete(scopeKey)
      },
    }
    scope!.waiting.push(waiter)
    signal?.addEventListener('abort', waiter.onAbort, { once: true })
  })
}

// @@@ one bounded batch per planned population, only the paths actually asked about - the tree comparison is pathspec-scoped
// (`:(literal)` so a path holding a glob char, a space or a leading colon is matched verbatim, `-z` so the
// answer needs no unquoting), and the answer retained is one boolean per REQUESTED path. Concurrent primes
// on the same anchor therefore union their paths BEFORE the child starts: a caller records what it needs in
// `pending`, then either starts the batch that drains pending or joins the running one and re-checks after —
// so a path requested mid-flight rides the NEXT batch instead of racing this one, and a settled path is
// never asked again. Every bounded chunk stays serial through the same scope permit.
const CONTENT_BATCH_RECORD_LIMIT = 8_192
const CONTENT_BATCH_ARGV_BYTE_LIMIT = 16 * 1_024
const CONTENT_BATCH_MARKER = '\x1espex-content:'
type ContentBatchRow = { sha: string; oid: string; entry: AnchorVerdicts; requested: string[] }

function contentBatchArgs(root: string, paths: readonly string[]): string[] {
  return [
    '-C', root, '-c', 'core.quotePath=false', 'diff-tree', '--stdin', '--always', '-r', '--name-status', '-z',
    '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', `--format=${CONTENT_BATCH_MARKER}%H`,
    '--', ...paths.map((path) => `:(literal)${path}`),
  ]
}
function argvBytes(args: readonly string[]): number {
  return args.reduce((total, arg) => total + Buffer.byteLength(arg) + 1, 0)
}

function contentBatchChunks(root: string, rows: ContentBatchRow[]): ContentBatchRow[][] {
  const chunks: ContentBatchRow[][] = []
  let byRow = new Map<ContentBatchRow, ContentBatchRow>()
  let paths = new Set<string>()
  const flush = () => {
    if (byRow.size) chunks.push([...byRow.values()])
    byRow = new Map()
    paths = new Set()
  }
  for (const row of rows) {
    for (const path of row.requested) {
      for (;;) {
        const nextPaths = paths.has(path) ? paths : new Set(paths).add(path)
        const nextRows = byRow.size + (byRow.has(row) ? 0 : 1)
        const withinRecords = nextRows * nextPaths.size <= CONTENT_BATCH_RECORD_LIMIT
        const withinArgv = argvBytes(contentBatchArgs(root, [...nextPaths])) <= CONTENT_BATCH_ARGV_BYTE_LIMIT
        if (withinRecords && withinArgv) break
        if (!byRow.size)
          throw new Error(`git content diff path exceeds the ${CONTENT_BATCH_ARGV_BYTE_LIMIT}-byte argv bound: ${path}`)
        flush()
      }
      let slice = byRow.get(row)
      if (!slice) {
        slice = { ...row, requested: [] }
        byRow.set(row, slice)
      }
      slice.requested.push(path)
      paths.add(path)
    }
  }
  flush()
  return chunks
}

function parseContentBatch(out: string, rows: ContentBatchRow[]): Set<string>[] {
  let rowIndex = -1
  let status: string | null = null
  const changed = rows.map(() => new Set<string>())
  for (const raw of out.split('\0')) {
    if (!raw) continue
    const token = raw.startsWith('\n') ? raw.slice(1) : raw
    if (status !== null) {
      if (rowIndex < 0 || rowIndex >= rows.length) throw new Error('git content diff batch emitted a path before its pair marker')
      changed[rowIndex].add(token)
      status = null
      continue
    }
    if (token.startsWith(CONTENT_BATCH_MARKER)) {
      rowIndex++
      if (rowIndex >= rows.length) throw new Error('git content diff batch emitted too many pair markers')
      continue
    }
    if (!/^[A-Z](?:\d+)?$/.test(token)) throw new Error(`git content diff batch emitted malformed status '${token}'`)
    status = token
  }
  if (status !== null) throw new Error(`git content diff batch ended after status '${status}'`)
  if (rowIndex + 1 !== rows.length)
    throw new Error(`git content diff batch emitted ${rowIndex + 1} pair markers for ${rows.length} pairs`)
  return changed
}

async function resolvedContentImages(
  root: string,
  raws: readonly string[],
  replacements: ReadonlyMap<string, string>,
): Promise<(string | null)[]> {
  const targets = raws.map((raw) => {
    let target = raw
    const seen = new Set<string>()
    while (replacements.has(target)) {
      if (seen.has(target)) throw new Error(`refs/replace cycle while resolving content image '${raw}'`)
      seen.add(target)
      target = replacements.get(target)!
    }
    return target
  })
  // One no-replace child proves both the names callers supplied and the exact final replacement targets.
  // A target cannot make a nonexistent raw id look available, and a missing replacement target is loud.
  const queries = [...new Set([...raws, ...targets])]
  const answers = await batchRevisionOids(root, queries, { replaceObjects: false })
  const checked = new Map(queries.map((query, index) => [query, answers[index]]))
  return raws.map((raw, index) => {
    if (!checked.get(raw)) return null
    const target = checked.get(targets[index])
    if (!target) throw new Error(`replacement target '${targets[index]}' for content image '${raw}' is unreadable`)
    return target
  })
}

async function runContentBatch(root: string, currentOid: string, rows: ContentBatchRow[]): Promise<void> {
  const settled: { row: ContentBatchRow; changed: Set<string> }[] = []
  for (const chunk of contentBatchChunks(root, rows)) {
    const paths = [...new Set(chunk.flatMap((row) => row.requested))].sort()
    const result = await gitTry(contentBatchArgs(root, paths), {
      input: chunk.map((row) => `${row.oid} ${currentOid}`).join('\n') + '\n',
      // batchRevisionOids already froze replacements/grafts into exact object ids. Do not reinterpret those
      // ids if refs/replace moves between the resolution child and this content child.
      extraEnv: { GIT_NO_REPLACE_OBJECTS: '1' },
    })
    if (!result.ok)
      throw new Error(`git content diff batch failed (${result.failure ?? 'unknown'}): ${result.stderr.trim() || 'unknown git error'}`)
    parseContentBatch(result.stdout, chunk).forEach((changed, index) => settled.push({ row: chunk[index], changed }))
  }
  // Publish only after every chunk succeeds. A late transport failure leaves the entire planned population
  // retryable instead of turning its early chunks into an accidental partial freshness answer.
  for (const { row, changed } of settled)
    for (const path of row.requested) row.entry.verdicts.set(path, changed.has(path))
}

function startPluralContentBatch(root: string, rootKey: string, scope: RootScope, rows: { sha: string; entry: AnchorVerdicts }[]): Promise<void> {
  const run = async (): Promise<void> => {
    const release = await acquireHeavyDiff(`${rootKey}\x1f${scope.head}`, currentGitBuildAbortSignal())
    const batch = rows.map((row) => ({ ...row, oid: row.entry.imageOid!, requested: [...row.entry.pending] }))
      .filter((row) => row.requested.length)
    for (const row of batch) row.entry.pending.clear()
    try { await runContentBatch(root, scope.currentOid!, batch) }
    finally { release() }
  }
  let flight!: Promise<void>
  flight = run().finally(() => {
    for (const row of rows) if (row.entry.flight === flight) row.entry.flight = null
  })
  for (const row of rows) row.entry.flight = flight
  return flight
}

// @@@ the drift COUNT is a reachability question, so ONE walk answers the whole roster - counting it as
// `rev-list --count <anchor>..<HEAD> -- <path>` names an OFF-HISTORY range, so Git can never cut the walk
// short: every (anchor, path) pair traverses the entire history, and the pairs multiply. Measured cold on a
// 437-anchor deployment scope: 1748 of the read's 1750 git children were those counts. What HEAD's index
// genuinely lacks is only the ANCHORS' own ancestry, and one `rev-list --parents` walk over the whole roster
// carries it; the count is then the same in-memory rule `eventsSince` applies on the in-history side. The
// walk is a SEPARATE structure from the shared drift index on purpose: grafting off-history tips into that
// index would make `ancestorsOf` stop answering undefined for them and silently switch the freshness
// DECISION from this content probe to ancestry. A rejected walk caches nothing and every joiner sees the
// same failure, matching the anchor batch above.
async function primeAnchorTopology(root: string, scope: RootScope, oids: readonly string[]): Promise<void> {
  for (;;) {
    const missing = oids.filter((oid) => !scope.topologyRoster.has(oid))
    if (!missing.length) return
    // an anchor that arrives mid-walk rides the NEXT one instead of racing this one, exactly as a
    // mid-flight path rides the next content batch.
    if (scope.topologyFlight) { await scope.topologyFlight; continue }
    const roster = [...new Set([...scope.topologyRoster, ...missing])]
    const run = async (): Promise<void> => {
      const reach = await unionTopology(root, roster)
      // one child-before-parent pass for the whole roster; the bytes are identical to asking one by one.
      primeAncestorClosures(reach, roster)
      scope.topology = reach
      scope.topologyRoster = new Set(roster)
    }
    let flight!: Promise<void>
    flight = run().finally(() => { if (scope.topologyFlight === flight) scope.topologyFlight = null })
    scope.topologyFlight = flight
    await flight
  }
}

export function contentProbeFor(root: string): ContentProbe {
  const rootKey = resolve(root)
  let head: string | undefined
  let activeImageKey: string | undefined
  const headOf = () => (head ??= headSha(root))
  const imageOf = () => {
    const rawHead = headOf()
    const interpretation = gitObjectInterpretation(root)
    return { rawHead, key: `${rawHead}\x1f${interpretation.identity}`, interpretation }
  }
  const primeMany = async (demands: readonly ContentProbeDemand[]): Promise<void> => {
    if (!demands.length) return
    const planned = new Map<string, { paths: Set<string>; codePaths: Set<string>; evalPaths: Set<string> }>()
    for (const demand of demands) {
      const row = planned.get(demand.anchorSha) ?? { paths: new Set(), codePaths: new Set(), evalPaths: new Set() }
      for (const path of demand.paths) { if (path) { row.paths.add(path); row.codePaths.add(path) } }
      if (demand.evalPath) { row.paths.add(demand.evalPath); row.evalPaths.add(demand.evalPath) }
      planned.set(demand.anchorSha, row)
    }
    let scope!: RootScope
    for (;;) {
      const image = imageOf()
      activeImageKey = image.key
      const current = scopeFor(rootKey, image.key, null)
      for (const [sha, row] of planned) {
        const entry = touchAnchor(current, sha, undefined)
        for (const path of row.paths) if (!entry.verdicts.has(path)) entry.pending.add(path)
      }
      const needsResolution = current.currentOid === null || [...planned].some(([sha]) => {
        const entry = current.anchors.get(sha)!
        return entry.imageOid === undefined || entry.gone
      })
      if (!needsResolution) { scope = current; break }
      // Resolve HEAD and every anchor in ONE child, then require the interpretation inputs to remain stable.
      // The returned object ids become the only images downstream commands may execute against.
      const shas = [...planned.keys()]
      const resolved = await resolvedContentImages(root, [image.rawHead, ...shas], image.interpretation.replacements)
      if (imageOf().key !== image.key) continue
      const currentOid = resolved[0]
      if (!currentOid) throw new Error(`git content diff current image '${image.rawHead}' is unreadable`)
      scope = scopeFor(rootKey, image.key, currentOid)
      shas.forEach((sha, index) => touchAnchor(scope, sha, resolved[index + 1]))
      break
    }
    const grouped = new Map<string, { entry: AnchorVerdicts; paths: Set<string>; codePaths: Set<string>; evalPaths: Set<string> }>()
    for (const [sha, row] of planned) {
      const entry = scope.anchors.get(sha)
      if (!entry) throw new Error(`git content diff did not resolve planned anchor '${sha}'`)
      grouped.set(sha, { entry, ...row })
    }
    for (;;) {
      const waiting = new Set<Promise<void>>()
      const ready: { sha: string; entry: AnchorVerdicts }[] = []
      for (const [sha, row] of grouped) {
        if (row.entry.gone) continue
        const missing = [...row.paths].filter((path) => !row.entry.verdicts.has(path))
        if (!missing.length) continue
        for (const path of missing) row.entry.pending.add(path)
        if (row.entry.flight) waiting.add(row.entry.flight)
        else ready.push({ sha, entry: row.entry })
      }
      if (waiting.size) { await Promise.all(waiting); continue }
      if (!ready.length) break
      await startPluralContentBatch(root, rootKey, scope, ready)
    }
    // only anchors whose governed content actually differs need their past: those are the readings that
    // will render a drift count, and a byte-identical population walks nothing at all.
    const drifted = [...grouped.values()]
      .filter((row) => !row.entry.gone && [...row.codePaths].some((path) => row.entry.verdicts.get(path) === true))
      .map((row) => row.entry.imageOid!)
    if (drifted.length) await primeAnchorTopology(root, scope, drifted)
    for (const [sha, row] of grouped) {
      if (row.entry.gone) continue
      for (const evalPath of row.evalPaths) if (row.entry.verdicts.get(evalPath) === true) {
        scope.blockDemands.add(`${row.entry.imageOid}\x1f${evalPath}`)
        scope.blockDemands.add(`${scope.currentOid}\x1f${evalPath}`)
      }
    }
  }
  return {
    async prime(sha, paths, evalPath) {
      await primeMany([{ anchorSha: sha, paths, evalPath }])
    },
    primeMany,
    async primeBlocks() {
      const image = imageOf()
      activeImageKey = image.key
      const scope = currentScope(rootKey, image.key)
      if (!scope?.blockDemands.size) return
      const demands = [...scope.blockDemands].map((k) => {
        const cut = k.indexOf('\x1f')
        return { rev: k.slice(0, cut), path: k.slice(cut + 1) }
      })
      scope.blockDemands.clear()
      await primeScenarioBlocks(root, demands)
    },
    changed(sha, path) {
      // The async prime owns all I/O. An unprimed path is 'can't testify', never a fresh sync diff: a miss
      // stays conservative and no abort/transient failure can turn into an unbounded synchronous fallback.
      const entry = activeImageKey ? currentScope(rootKey, activeImageKey)?.anchors.get(sha) : undefined
      if (!entry || entry.gone) return null
      return entry.verdicts.get(path) ?? null
    },
    canTestify(sha) {
      // a settled verdict — of either polarity — is the proof the anchor's tree was readable
      const entry = activeImageKey ? currentScope(rootKey, activeImageKey)?.anchors.get(sha) : undefined
      return !!entry && !entry.gone && entry.verdicts.size > 0
    },
    scenarioDiffers(sha, evalPath, scenario) {
      const scope = activeImageKey ? currentScope(rootKey, activeImageKey) : undefined
      const entry = scope?.anchors.get(sha)
      const a = entry?.imageOid ? scenarioBlocksAt(root, entry.imageOid, evalPath) : null
      if (!a) return true   // eval.md unreadable at the anchor (renamed/absent) → can't prove → stale
      return a.get(scenario) !== scenarioBlocksAt(root, scope!.currentOid!, evalPath)?.get(scenario)
    },
    inAnchorPast(sha, commit) {
      const scope = activeImageKey ? currentScope(rootKey, activeImageKey) : undefined
      const oid = scope?.anchors.get(sha)?.imageOid
      if (!scope?.topology || !oid) return false
      const bits = ancestorsOf(scope.topology, oid)
      return !!bits && inAncestors(scope.topology, bits, commit)
    },
  }
}

// @@@ the code axis's SPATIAL narrowing ([[code-anchor]]'s path#symbol, reused whole) - a shared FILE is not a
// shared BEHAVIOUR: harness.ts carries eight adapters, so a one-adapter edit re-flagged every other adapter's
// reading, and those refresh only through a real dispatched session of that harness. An anchored entry
// therefore asks the spatial question instead of the file question — did a commit in codeSha..HEAD intersect
// one of the named units? — through the SAME parse/extract/resolve/hunk∩range engine spec drift runs. Two
// deliberate differences from that engine: the window carries NO ack filter (an ack vindicates a spec, not a
// reading), and it never widens — the file question runs FIRST and the anchor can only subtract from it.
// Fed at the call sites like the ContentProbe, so the decision functions stay pure over their inputs.
export type AnchorProbe = {
  // did any commit in sinceSha..HEAD touch one of THESE anchored units?
  // null = cannot testify (unprimed, off-history, no usable extractor) — callers stay conservatively stale.
  hit(sinceSha: string, path: string, selectors: readonly string[]): boolean | null
  // The demand set is PLURAL because the engine underneath is: every window's Git images and ordinary hunks
  // are immutable, so one call owns them once for the whole read. A caller that primes one reading at a time
  // re-forks that batch per reading, which on this corpus was ~2.5k children for ~800 verdicts.
  prime?(demands: readonly AnchorDemand[]): Promise<void>
}
export type AnchorDemand = { sinceSha: string; entries: readonly RelationEntry[] }

// a verdict answers ONE selector set, so the set is part of its identity: several scenarios anchoring
// DIFFERENT units of one shared file is the whole point of narrowing, and keying only by (sha, path) would
// hand the first one's answer to all the others — silently, and in the fresh direction.
const anchorKey = (sinceSha: string, path: string, selectors: readonly string[]) =>
  `${sinceSha}\x1f${path}\x1f${[...selectors].sort().join('\x1e')}`

// @@@ one parse per CONTENT, not per selector entry - a node's `code:` entries are asked one at a time, and
// the same working-tree file backs many of them, so the unmemoized read parsed 46 distinct files 922 times
// per build (40.4 MB through the TypeScript parser) and did it again on every rebuild. `extract` is a pure
// function of (text, path, extractor), so its result is reusable exactly as far as the CONTENT is unchanged.
// The key is a content digest and never mtime/size: this gate decides whether a reading may testify, so a
// stale unit list would let a dead selector read as alive — the precise failure the comment below warns
// about. Digesting is ~10x cheaper than parsing, so the read stays and only the parse is saved. Bounded like
// the historical-revision memo it mirrors ([[code-anchor]]), and it caches the extractor's REJECTION too, so
// an unparseable file does not re-parse once per entry.
const CURRENT_TREE_MEMO_MAX = 4096
const currentTreeUnitMemo = new Map<string, { units: Unit[] } | { failed: string }>()
// The memo key doubles as the IMAGE's name — the extractor that answered plus the exact bytes it read — so a
// caller retaining a verdict derived from these units names it by the same identity that decides the parse
// ([[selector-anchor-scope]]). Returning the key rather than re-deriving it elsewhere is what keeps the two
// from drifting apart.
function currentTreeImage(root: string, x: Extractor, path: string): { key: string; units: Unit[] } {
  const source = readFileSync(join(root, path), 'utf8')
  const key = `${x.memoKey(path)}\0${createHash('sha1').update(source).digest('hex')}`
  const hit = currentTreeUnitMemo.get(key)
  if (hit) { if ('failed' in hit) throw new Error(hit.failed); return { key, units: hit.units } }
  let entry: { units: Unit[] } | { failed: string }
  try { entry = { units: x.extract(source, path) } }
  catch (err: any) { entry = { failed: err?.message ?? String(err) } }
  if (currentTreeUnitMemo.size >= CURRENT_TREE_MEMO_MAX) currentTreeUnitMemo.clear()
  currentTreeUnitMemo.set(key, entry)
  if ('failed' in entry) throw new Error(entry.failed)
  return { key, units: entry.units }
}

// what selector resolution READS for one path, named by its identity — or the reason nothing could be read.
// Split out from the verdict below so a caller can name the image before deciding whether it still has to
// derive the verdict at all; a `problem` image has no name, and an unnameable input is never retained.
type EntryImage = { key: string; units: Unit[] } | { problem: string }
function entryImage(root: string, regs: Extractor[], path: string, selector: string | undefined): EntryImage {
  const x = extractorFor(regs, extOf(path))
  if (!x) return { problem: `\`code\` selector \`${path}#${selector}\` — no designated extractor for that language; drop the #anchor or add a language row` }
  const ready = x.ready()
  if (ready !== true) return { problem: `\`code\` anchors on ${path} are unverified: ${ready}` }
  try { return currentTreeImage(root, x, path) }
  catch (err: any) { return { problem: `\`code\` anchors on ${path} are unverified: ${err?.message ?? String(err)}` } }
}

// every selector of one entry resolves to exactly one unit in the CURRENT tree, or the entry cannot testify.
// This gate is what stops a DEAD selector from reading fresh: the hit engine answers "no commit touched a
// unit of that name", which for a name that exists nowhere is a vacuous no — true of spec drift, where the
// dead anchor is a separate blocking error, and dangerously false here, where the same silence would retire
// a reading's whole code axis. `problem` names the repair for lint; null means the entry is verifiable.
function selectorProblem(units: Unit[], path: string, selectors: readonly string[]): string | null {
  // the SAME classifier the gate uses ([[code-anchor]]'s resolveSelectors) — only the wording is ours, so a
  // selector can never be verifiable to one reader and dead to the other.
  for (const r of resolveSelectors(units, selectors)) {
    if ('dead' in r) return `\`code\` selector \`${path}#${r.selector}\` names no unit in that file — follow the rename or drop the selector (evals stay stale until then)`
    if ('ambiguous' in r) return `\`code\` selector \`${path}#${r.selector}\` is ambiguous — ${r.ambiguous} units share that name; pin a unique one`
  }
  return null
}
function entryUnverifiable(root: string, regs: Extractor[], entry: RelationEntry): string | null {
  const image = entryImage(root, regs, entry.path, entry.selectors[0])
  return 'problem' in image ? image.problem : selectorProblem(image.units, entry.path, entry.selectors)
}

// @@@ the verify sweep must reach the MACROTASK queue - resolving every reading's `code:` selectors against
// the working tree is a doubly-nested SYNCHRONOUS sweep (4,384 demands on this corpus), and nothing in it
// awaits, so it ran as one uninterruptible stretch: measured, it held the loop for 1,104ms, which is the
// `/health` p99 this gate is judged by. The bound defended here is a LIVENESS signal, not a latency taste —
// a probe that cannot answer is indistinguishable from a dead backend, and the CLI allows it 600ms while the
// supervisor allows 1,000ms before it keeps the old child. `setImmediate` is what actually returns to the
// loop's I/O phase (awaiting a synchronous-bodied async fn only drains microtasks). A time budget rather
// than every-iteration keeps the common cheap iteration from paying a turn: the sweep's own longest single
// step is one file parse, so the worst hold stays near budget + that step.
const VERIFY_YIELD_BUDGET_MS = Number(process.env.SPEXCODE_VERIFY_YIELD_BUDGET_MS || 50)
const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => { setImmediate(resolve) })

// A verdict's window is `sinceSha..HEAD`, and that window LENGTHENS as HEAD advances — the same
// (sinceSha, path, selectors) that answers false at one head can legitimately answer true at the next. So
// these are per-head immutable, never content-addressed-forever, and they belong in the root's current-head
// scope above rather than in a memo of their own ([[selector-anchor-scope]]).
// The working tree, however, does NOT stand still at one head: a session re-images the files a selector
// resolves against, and each image is its own key. Bound that with the same drop-wholesale idiom the
// current-tree parse memo uses instead of inventing a second eviction policy.
const ANCHOR_VERDICT_MAX = Math.max(1024, Number(process.env.SPEXCODE_ANCHOR_VERDICT_SLOTS || 8192))

export function anchorProbeFor(root: string, idx: DriftIndex): AnchorProbe {
  const rootKey = resolve(root)
  const regs = extractors(root)
  const verdicts = new Map<string, boolean>()
  // The scope is the one the content probe already owns, entered only when the index's own tip IS the
  // current head. An index built at another tip cannot borrow this head's answers, and — the reason this is
  // a guard rather than a rotation — a head that moved mid-read must not make THIS probe displace the
  // content probe's just-settled scope. Either the two probes agree on the head and share one scope, or this
  // one keeps nothing and recomputes.
  const scopeOf = (): RootScope | null => {
    if (!idx.tip) return null
    const rawHead = headSha(root)
    if (idx.tip !== rawHead) return null
    return scopeFor(rootKey, `${rawHead}\x1f${gitObjectInterpretation(root).identity}`, null)
  }
  // which extractor BUILD answered is part of a verdict's identity too — a host TypeScript resolving to a
  // different module or version must not inherit the previous one's units.
  const registry = regs.map((x) => x.memoKey('\0registry')).join('\x1e')
  return {
    async prime(demands) {
      const scope = scopeOf()
      const keys: string[] = []
      const scoped: (string | null)[] = []
      const queries: AnchorHitQuery[] = []
      const queued = new Set<string>()
      // one coherent read of each source per sweep: every entry on a path resolves against the same bytes,
      // and the read that names the verdict is the read the verdict was derived from.
      const images = new Map<string, EntryImage>()
      const imageOf = (path: string, selector: string | undefined): EntryImage => {
        let hit = images.get(path)
        if (hit === undefined) { hit = entryImage(root, regs, path, selector); images.set(path, hit) }
        return hit
      }
      const remember = (name: string | null, hit: boolean) => { if (scope && name !== null) {
        if (scope.anchorVerdicts.size >= ANCHOR_VERDICT_MAX) scope.anchorVerdicts.clear()
        scope.anchorVerdicts.set(name, hit)
      } }
      let sinceYield = Date.now()
      for (const { sinceSha, entries } of demands) for (const e of entries) {
        if (Date.now() - sinceYield >= VERIFY_YIELD_BUDGET_MS) { await yieldToEventLoop(); sinceYield = Date.now() }
        if (!e.selectors.length) continue
        const key = anchorKey(sinceSha, e.path, e.selectors)
        if (verdicts.has(key) || queued.has(key)) continue
        const image = imageOf(e.path, e.selectors[0])
        const name = 'problem' in image ? null : `${registry}\x1f${image.key}\x1f${key}`
        const remembered = scope && name !== null ? scope.anchorVerdicts.get(name) : undefined
        if (remembered !== undefined) { verdicts.set(key, remembered); continue }
        // a miss runs the FULL derivation below, unchanged — it is what a verdict MEANS, not a fallback
        if ('problem' in image || selectorProblem(image.units, e.path, e.selectors)) continue  // no verdict → conservative stale (lint says why)
        const win = eventsSince(idx, sinceSha, e.path)
        if (win === null) continue
        if (!win.length) { verdicts.set(key, false); remember(name, false); continue }
        queued.add(key)
        keys.push(key)
        scoped.push(name)
        queries.push({ win, symbols: [...e.selectors] })
      }

      if (!queries.length) return
      const results = await anchorHitExists(root, queries, regs)
      results.forEach((hit, index) => { verdicts.set(keys[index], hit); remember(scoped[index], hit) })
    },
    hit(sinceSha, path, selectors) {
      return verdicts.get(anchorKey(sinceSha, path, selectors)) ?? null
    },
  }
}

// the LOUD half: a selector is a claim that a named unit EXISTS, held to the same standard as a ghost path.
// Dead, ambiguous, unparseable, or no designated extractor — each names itself and its repair, and until
// repaired the probe issues no verdict, so the reading stays stale. Over-warn, never a silent pass.
export function anchorProblems(root: string, entries: readonly RelationEntry[]): string[] {
  const regs = extractors(root)
  const out: string[] = []
  for (const e of entries) {
    if (!e.selectors.length) continue
    const problem = entryUnverifiable(root, regs, e)
    if (problem) out.push(problem)
  }
  return out
}

// the REMARK axis's input ([[remark-teeth]]): the teeth read only the resolvable bit + when it was resolved,
// not the whole remark — so freshness stays a PURE function, fed the scenario's remark track at the call
// sites (never reaching into the issue store). One signal per remark on the (node, scenario).
export type RemarkSignal = { resolved: boolean; resolvedAt?: string }

// the teeth (T1): a scenario is remark-stale unless EVERY remark is resolved AND this reading post-dates
// every resolution. So an UNRESOLVED remark ages it; a RESOLVED remark keeps it stale until a reading taken
// strictly after the resolve (reading.ts > resolvedAt) exists — you can't out-run a remark by re-measuring
// before the resolve, nor clear it by passive receipt. A resolved bit with no timestamp stays conservatively
// stale (defensive: resolveRemark always stamps one).
export function remarkStale(reading: { ts: string }, remarks: RemarkSignal[]): boolean {
  return remarks.some((r) => !r.resolved || !(r.resolvedAt && reading.ts > r.resolvedAt))
}

// true iff some commit touched `path` that is NOT an ancestor of `sinceSha` — i.e. it lies in
// `sinceSha..HEAD` by true DAG reachability, never a log-position/date compare (which under-reports on
// branchy history). An off-history `sinceSha` falls back to the content probe when one is fed (see
// ContentProbe above); without a probe — or when the anchor object is gone — freshness can't be proven
// from HEAD's history, so it reads stale rather than silently pass.
export function changedSince(idx: DriftIndex, sinceSha: string, path: string, probe?: ContentProbe): boolean {
  const events = eventsSince(idx, sinceSha, path)
  // null = ancestry cannot testify for this anchor; only then does content get a say ([[root-lru]]'s sibling
  // rule: one meaning of changed-since, each layer's own fallback on top).
  if (events) return events.length > 0
  return probe?.changed(sinceSha, path) ?? true
}

// the code axis's DISPLAY detail: which governed files drifted since a reading, and by HOW MANY commits — so
// a stale eval can say "EvalsFeed.jsx +3" instead of a bare "code moved". Same DAG reachability as
// changedSince (a commit touching the file that is NOT an ancestor of the reading's sha lies in sinceSha..HEAD);
// an off-history sinceSha reports through the same content fallback (only files whose content differs, counted
// against the anchor's own ancestry); with no probe or a gone anchor it counts every touch (conservative,
// matching changedSince).
// Reporting only — it never decides freshness (staleAxes does); it explains a decision already made.
export function codeDrift(idx: DriftIndex, sinceSha: string, codeAxis: ScenarioCodeAxisSource, probe?: ContentProbe): { file: string; behind: number }[] {
  // an entry may be anchored (`path#symbol`); drift is reported per BASE FILE — a raw selector string names
  // no real path, so counting commits against it would silently report nothing.
  const codeFiles = scenarioCodeAxis(undefined, codeAxis).paths
  const out: { file: string; behind: number }[] = []
  for (const f of codeFiles) {
    const since = eventsSince(idx, sinceSha, f)
    const events = pathEvents(idx, f)
    const differs = since ? undefined : probe?.changed(sinceSha, f)
    const behind = since ? new Set(since.map((event) => event.commit)).size
      // off-history and the content differs: the SAME rule as the in-history branch above — the path's events
      // this anchor has not already seen — read against the anchor's own ancestry instead of HEAD's. Floored
      // at one: the trees demonstrably differ, so 'drifted by 0 commits' would be a lie whatever the walk
      // could and could not project.
      : differs === true ? Math.max(1, new Set(events.filter((event) => !probe!.inAnchorPast(sinceSha, event.commit)).map((event) => event.commit)).size)
      : differs === false ? 0
      : new Set(events.map((event) => event.commit)).size
    if (behind > 0) out.push({ file: f, behind })
  }
  return out
}

// @@@scenario axis decides by stored contract hash - a reading filed since #61 carries `scenarioHash`, the
// content hash of the semantic text it was measured against (scenarios.ts scenarioHash — normalized
// description+expected). For such a reading the scenario axis is a PURE TEXT COMPARE: recorded hash vs the
// CURRENT declaration's hash — no git walk, no chain, no ancestry. That is what makes it converge under
// fleet-parallel filing+merging: a sibling scenario's edit, a sidecar-only commit, a merge's textual shift,
// a whitespace re-wrap — none of them move THIS scenario's hash, so none can re-stale its reading; only the
// contract actually changing (or the scenario disappearing from eval.md — `current` undefined) does. A
// LEGACY reading without the hash is decided by the git-derived per-scenario rule below, unchanged — the
// one-shot degradation: exactly ONE track decides each reading (hash if present, else git), never both
// OR-ed together.
function scenarioStaleByHash(reading: Reading, current: Scenario | undefined): boolean | undefined {
  if (reading.scenarioHash === undefined) return undefined   // legacy → the git rule decides
  return current ? scenarioHash(current) !== reading.scenarioHash : true
}

// LEGACY scenario freshness (readings filed before the stored contract hash) — PER-SCENARIO and SEMANTIC,
// not per-file: a reading stales only when ITS OWN scenario's semantic block (description+expected —
// [[scenariofresh]]'s blockContent projection) moved in scenarioSha..HEAD — never when a sibling in the
// same eval.md did, and never on a metadata-only edit (tags/test/code/related). Reads like the code axis's
// changedSince — the per-scenario change-commits ([[scenariofresh]], rename-followed so a bare git-mv
// reparent isn't a change) tested for ancestry — and an off-history codeSha takes the same content fallback
// at the same granularity and the same projection. Known limit (#61, why the hash replaced it for new
// readings): the change-commit chain is built off a LINEARIZED log walk, so parallel branches editing one
// eval.md cross-attribute each other's edits and can false-stale a sibling's reading across a merge.
function scenarioMoved(scIdx: ScenarioIndex, didx: DriftIndex, sinceSha: string, evalPath: string, scenario: string, probe?: ContentProbe): boolean {
  const anc = ancestorsOf(didx, sinceSha)
  if (anc) return scenarioChangeCommits(scIdx, evalPath, scenario).some((h) => !inAncestors(didx, anc, h))
  const differs = probe?.changed(sinceSha, evalPath)
  if (differs == null) return true
  if (!differs) return false   // whole file byte-identical → this block too
  return probe!.scenarioDiffers(sinceSha, evalPath, scenario)
}

// one declared entry's contribution to the code axis. The FILE question runs first and is unchanged; only an
// ANCHORED entry whose file really moved asks the narrower spatial one, so an anchor can subtract from the
// file verdict but never add to it. No verdict (unprimed, off-history, unverifiable selector) → conservative.
function entryMoved(idx: DriftIndex, sinceSha: string, entry: RelationEntry, probe?: ContentProbe, anchors?: AnchorProbe): boolean {
  if (!changedSince(idx, sinceSha, entry.path, probe)) return false
  if (!entry.selectors.length) return true
  return anchors?.hit(sinceSha, entry.path, entry.selectors) ?? true
}

export function staleAxes(
  reading: Reading,
  codeAxis: ScenarioCodeAxisSource,
  evalPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
  current?: Scenario,   // the scenario's CURRENT declaration (undefined = gone from eval.md) — the hash compare's other side
  anchors?: AnchorProbe,
): StaleAxis[] {
  const axes: StaleAxis[] = []
  const byHash = scenarioStaleByHash(reading, current)
  if (probe && !commitReachable(didx, reading.codeSha) && !probe.canTestify(reading.codeSha)) {
    // the anchor commit object is GONE — neither git axis can testify; say that, not "content changed".
    // The stored contract hash needs no anchor, so it still decides the scenario axis when present.
    axes.push('anchor')
    if (byHash) axes.push('scenario')
  } else {
    if (scenarioCodeAxis(undefined, codeAxis).entries.some((e) => entryMoved(didx, reading.codeSha, e, probe, anchors))) axes.push('code')
    if (byHash ?? scenarioMoved(scIdx, didx, reading.codeSha, evalPath, reading.scenario, probe)) axes.push('scenario')
  }
  if (remarkStale(reading, remarks)) axes.push('remark')
  return axes
}

export function isStale(
  reading: Reading,
  codeAxis: ScenarioCodeAxisSource,
  evalPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
  current?: Scenario,
  anchors?: AnchorProbe,
): boolean {
  return staleAxes(reading, codeAxis, evalPath, didx, scIdx, remarks, probe, current, anchors).length > 0
}
