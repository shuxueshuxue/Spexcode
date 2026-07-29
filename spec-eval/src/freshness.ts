import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gitA, gitTry, headSha, currentGitBuildAbortSignal, gitAbortError, ancestorsOf, inAncestors, commitReachable, pathEvents, type DriftIndex, type DriftPathEvent, eventsSince } from '../../spec-cli/src/git.js'
import { anchorHitCommits, extOf, extractorFor, extractors, resolveAnchor, type Extractor, type RelationEntry } from '../../spec-cli/src/anchors.js'
import type { Reading } from './sidecar.js'
import { scenarioCodeAxis, scenarioHash, type Scenario, type ScenarioCodeAxisSource } from './scenarios.js'
import { scenarioChangeCommits, scenarioBlocksAt, primeScenarioBlocksAt, type ScenarioIndex } from './scenariofresh.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'remark' | 'anchor'

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
  // codeDrift's display detail: commits in anchor..HEAD touching path (floored at 1 — the content differs)
  behind(anchorSha: string, path: string): number
  prime?(anchorSha: string, paths: string[], evalPath: string): Promise<void>
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
  verdicts: Map<string, boolean>   // requested path → content differs between the two immutable trees
  gone: boolean                    // the anchor commit object is locally unreadable — content can't testify
  pending: Set<string>             // paths awaiting the next batch child
  flight: Promise<void> | null     // the single in-flight batch for this anchor
}
type RootScope = { head: string; anchors: Map<string, AnchorVerdicts>; behind: Map<string, number> }
const rootScopes = new Map<string, RootScope>()
// Roots come and go (a closed worktree never asks again), so cap how many stay warm — the same bounded-slot
// guard the index caches use, and the only bound needed once per-root cardinality is the corpus, not history.
const ROOT_SLOTS = Math.max(4, Number(process.env.SPEXCODE_FRESHNESS_ROOT_SLOTS || 64))

function scopeFor(rootKey: string, head: string): RootScope {
  const current = rootScopes.get(rootKey)
  if (current?.head === head) {
    rootScopes.delete(rootKey)
    rootScopes.set(rootKey, current)
    return current
  }
  const scope: RootScope = { head, anchors: new Map(), behind: new Map() }
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

function touchAnchor(scope: RootScope, sha: string): AnchorVerdicts {
  const hit = scope.anchors.get(sha)
  if (hit) return hit
  const entry: AnchorVerdicts = { verdicts: new Map(), gone: false, pending: new Set(), flight: null }
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

// @@@ one batch per anchor, only the paths actually asked about - the tree comparison is pathspec-scoped
// (`:(literal)` so a path holding a glob char, a space or a leading colon is matched verbatim, `-z` so the
// answer needs no unquoting), and the answer retained is one boolean per REQUESTED path. Concurrent primes
// on the same anchor therefore union their paths BEFORE the child starts: a caller records what it needs in
// `pending`, then either starts the batch that drains pending or joins the running one and re-checks after —
// so a path requested mid-flight rides the NEXT batch instead of racing this one, and a settled path is
// never asked again. Different anchors stay serial through the same scope permit.
function startAnchorBatch(root: string, rootKey: string, sha: string, current: string, entry: AnchorVerdicts): Promise<void> {
  const run = async (): Promise<void> => {
    const release = await acquireHeavyDiff(`${rootKey}\x1f${current}`, currentGitBuildAbortSignal())
    // drain AFTER the permit, so every caller that registered while this batch was waiting rides THIS
    // child instead of paying for another one; anything registered after this line is the next batch.
    const batch = [...entry.pending]
    entry.pending.clear()
    try {
      if (!batch.length) return
      const result = await gitTry(['-C', root, 'diff', '--name-only', '-z', '--no-renames', sha, current,
        '--', ...batch.map((path) => `:(literal)${path}`)])
      if (!result.ok && result.failure !== 'exit')
        throw new Error(`git content diff failed (${result.failure ?? 'unknown'}): ${result.stderr.trim() || 'unknown git error'}`)
      if (!result.ok) { entry.gone = true; return }   // the anchor commit object is unreadable — content can't testify
      const changed = new Set(result.stdout.split('\0').filter(Boolean))
      for (const path of batch) entry.verdicts.set(path, changed.has(path))
    } finally {
      release()
    }
  }
  const flight = run().finally(() => { if (entry.flight === flight) entry.flight = null })
  entry.flight = flight
  return flight
}

export function contentProbeFor(root: string): ContentProbe {
  const rootKey = resolve(root)
  let head: string | undefined
  const headOf = () => (head ??= headSha(root))
  return {
    async prime(sha, paths, evalPath) {
      const current = headOf()
      const wanted = [...new Set([...paths, evalPath])].filter(Boolean)
      // one scope resolve per prime: the entry stays this call's to settle even if the root's head moves
      // under it, but the swap means nothing it writes afterwards can be read back at the new head.
      const scope = scopeFor(rootKey, current)
      const entry = touchAnchor(scope, sha)
      while (!entry.gone) {
        const missing = wanted.filter((path) => !entry.verdicts.has(path))
        if (!missing.length) break
        for (const path of missing) entry.pending.add(path)
        // record first, then join: whoever starts the next batch drains everything pending by now.
        if (entry.flight) await entry.flight
        else await startAnchorBatch(root, rootKey, sha, current, entry)
      }
      if (entry.gone) return
      for (const path of new Set(paths)) {
        if (entry.verdicts.get(path) !== true) continue
        const behindKey = `${sha}\x1f${path}`
        if (scope.behind.has(behindKey)) continue
        const n = Number((await gitA(['-C', root, 'rev-list', '--count', `${sha}..${current}`, '--', path])).trim())
        scope.behind.set(behindKey, Number.isFinite(n) && n > 0 ? n : 1)
      }
      if (entry.verdicts.get(evalPath) === true) await primeScenarioBlocksAt(root, [sha, current], evalPath)
    },
    changed(sha, path) {
      // The async prime owns all I/O. An unprimed path is 'can't testify', never a fresh sync diff: a miss
      // stays conservative and no abort/transient failure can turn into an unbounded synchronous fallback.
      const entry = currentScope(rootKey, headOf())?.anchors.get(sha)
      if (!entry || entry.gone) return null
      return entry.verdicts.get(path) ?? null
    },
    canTestify(sha) {
      // a settled verdict — of either polarity — is the proof the anchor's tree was readable
      const entry = currentScope(rootKey, headOf())?.anchors.get(sha)
      return !!entry && !entry.gone && entry.verdicts.size > 0
    },
    scenarioDiffers(sha, evalPath, scenario) {
      const a = scenarioBlocksAt(root, sha, evalPath)
      if (!a) return true   // eval.md unreadable at the anchor (renamed/absent) → can't prove → stale
      return a.get(scenario) !== scenarioBlocksAt(root, headOf(), evalPath)?.get(scenario)
    },
    behind(sha, path) {
      return currentScope(rootKey, headOf())?.behind.get(`${sha}\x1f${path}`) ?? 1
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
  prime?(sinceSha: string, entries: readonly RelationEntry[]): Promise<void>
}

// a verdict answers ONE selector set, so the set is part of its identity: several scenarios anchoring
// DIFFERENT units of one shared file is the whole point of narrowing, and keying only by (sha, path) would
// hand the first one's answer to all the others — silently, and in the fresh direction.
const anchorKey = (sinceSha: string, path: string, selectors: readonly string[]) =>
  `${sinceSha}\x1f${path}\x1f${[...selectors].sort().join('\x1e')}`

// every selector of one entry resolves to exactly one unit in the CURRENT tree, or the entry cannot testify.
// This gate is what stops a DEAD selector from reading fresh: the hit engine answers "no commit touched a
// unit of that name", which for a name that exists nowhere is a vacuous no — true of spec drift, where the
// dead anchor is a separate blocking error, and dangerously false here, where the same silence would retire
// a reading's whole code axis. `problem` names the repair for lint; null means the entry is verifiable.
function entryUnverifiable(root: string, regs: Extractor[], entry: RelationEntry): string | null {
  const x = extractorFor(regs, extOf(entry.path))
  if (!x) return `\`code\` selector \`${entry.path}#${entry.selectors[0]}\` — no designated extractor for that language; drop the #anchor or add a language row`
  const ready = x.ready()
  if (ready !== true) return `\`code\` anchors on ${entry.path} are unverified: ${ready}`
  let units
  try { units = x.extract(readFileSync(join(root, entry.path), 'utf8'), entry.path) }
  catch (err: any) { return `\`code\` anchors on ${entry.path} are unverified: ${err?.message ?? String(err)}` }
  for (const sym of entry.selectors) {
    const r = resolveAnchor(units, sym)
    if ('dead' in r) return `\`code\` selector \`${entry.path}#${sym}\` names no unit in that file — follow the rename or drop the selector (evals stay stale until then)`
    if ('ambiguous' in r) return `\`code\` selector \`${entry.path}#${sym}\` is ambiguous — ${r.ambiguous} units share that name; pin a unique one`
  }
  return null
}

export function anchorProbeFor(root: string, idx: DriftIndex): AnchorProbe {
  const regs = extractors(root)
  const verdicts = new Map<string, boolean>()
  return {
    async prime(sinceSha, entries) {
      for (const e of entries) {
        if (!e.selectors.length) continue
        const key = anchorKey(sinceSha, e.path, e.selectors)
        if (verdicts.has(key)) continue
        if (entryUnverifiable(root, regs, e)) continue  // no verdict → conservative stale (lint says why)
        const win = eventsSince(idx, sinceSha, e.path)
        if (win === null) continue
        if (!win.length) { verdicts.set(key, false); continue }
        const hits = await anchorHitCommits(root, win, [...e.selectors], regs)
        verdicts.set(key, hits.length > 0)
      }
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
// by rev-list); with no probe or a gone anchor it counts every touch (conservative, matching changedSince).
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
      : differs === true ? probe!.behind(sinceSha, f)
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
