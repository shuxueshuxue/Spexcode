import { resolve } from 'node:path'
import { gitA, gitTry, headSha, currentGitBuildAbortSignal, gitAbortError, ancestorsOf, inAncestors, commitReachable, pathCommitsSince, type DriftIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { scenarioHash, type Scenario } from './scenarios.js'
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

// (anchor, HEAD) name two immutable trees, so entries never invalidate; the LRU only bounds memory,
// sized above the largest adopter reading corpus — one entry per (reading, path) worst case — so a
// repeat board build never thrashes back into forking (a bound below the corpus's distinct key count
// turns a fixed-order rebuild into sequential thrash: every pass evicts the whole memo before cycling
// back, re-forking one git child per key forever — scenariofresh's oidMemo sizing rule).
// An anchor entry holds only PER-REQUESTED-PATH verdicts (plus the gone bit and the batch bookkeeping),
// never a whole-repo path set.
type AnchorVerdicts = {
  verdicts: Map<string, boolean>   // requested path → content differs between the two immutable trees
  gone: boolean                    // the anchor commit object is locally unreadable — content can't testify
  pending: Set<string>             // paths awaiting the next batch child
  flight: Promise<void> | null     // the single in-flight batch for this anchor
}
const anchorMemo = new Map<string, AnchorVerdicts>()
const behindMemo = new Map<string, number>()
function readMemo<V>(m: Map<string, V>, k: string): V | undefined {
  if (!m.has(k)) return undefined
  const value = m.get(k)!
  m.delete(k)
  m.set(k, value)
  return value
}
function putMemo<V>(m: Map<string, V>, k: string, value: V): void {
  m.delete(k)
  m.set(k, value)
  if (m.size > 4096) m.delete(m.keys().next().value!)
}

const anchorKey = (rootKey: string, sha: string, head: string): string => `${rootKey}\x1f${sha}\x1f${head}`
function lookupAnchor(key: string): AnchorVerdicts | undefined {
  const hit = anchorMemo.get(key)
  if (!hit) return undefined
  anchorMemo.delete(key)
  anchorMemo.set(key, hit)
  return hit
}
function touchAnchor(key: string): AnchorVerdicts {
  const hit = lookupAnchor(key)
  if (hit) return hit
  const entry: AnchorVerdicts = { verdicts: new Map(), gone: false, pending: new Set(), flight: null }
  anchorMemo.set(key, entry)
  // an entry whose batch is still running would lose its writes if dropped, so eviction skips it; the
  // in-flight population is bounded by the build's own concurrency, never by the corpus.
  while (anchorMemo.size > 4096) {
    const stale = [...anchorMemo].find(([, value]) => !value.flight)
    if (!stale) break
    anchorMemo.delete(stale[0])
  }
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
      const key = anchorKey(rootKey, sha, current)
      const wanted = [...new Set([...paths, evalPath])].filter(Boolean)
      let entry = touchAnchor(key)
      while (!entry.gone) {
        const missing = wanted.filter((path) => !entry.verdicts.has(path))
        if (!missing.length) break
        for (const path of missing) entry.pending.add(path)
        // record first, then join: whoever starts the next batch drains everything pending by now.
        if (entry.flight) await entry.flight
        else await startAnchorBatch(root, rootKey, sha, current, entry)
        entry = touchAnchor(key)
      }
      if (entry.gone) return
      for (const path of new Set(paths)) {
        if (entry.verdicts.get(path) !== true) continue
        const behindKey = `${rootKey}\x1f${sha}\x1f${current}\x1f${path}`
        if (behindMemo.has(behindKey)) continue
        const n = Number((await gitA(['-C', root, 'rev-list', '--count', `${sha}..${current}`, '--', path])).trim())
        putMemo(behindMemo, behindKey, Number.isFinite(n) && n > 0 ? n : 1)
      }
      if (entry.verdicts.get(evalPath) === true) await primeScenarioBlocksAt(root, [sha, current], evalPath)
    },
    changed(sha, path) {
      // The async prime owns all I/O. An unprimed path is 'can't testify', never a fresh sync diff: a miss
      // stays conservative and no abort/transient failure can turn into an unbounded synchronous fallback.
      const entry = lookupAnchor(anchorKey(rootKey, sha, headOf()))
      if (!entry || entry.gone) return null
      return entry.verdicts.get(path) ?? null
    },
    canTestify(sha) {
      // a settled verdict — of either polarity — is the proof the anchor's tree was readable
      const entry = lookupAnchor(anchorKey(rootKey, sha, headOf()))
      return !!entry && !entry.gone && entry.verdicts.size > 0
    },
    scenarioDiffers(sha, evalPath, scenario) {
      const a = scenarioBlocksAt(root, sha, evalPath)
      if (!a) return true   // eval.md unreadable at the anchor (renamed/absent) → can't prove → stale
      return a.get(scenario) !== scenarioBlocksAt(root, headOf(), evalPath)?.get(scenario)
    },
    behind(sha, path) {
      return readMemo(behindMemo, `${rootKey}\x1f${sha}\x1f${headOf()}\x1f${path}`) ?? 1
    },
  }
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
  if (idx.lazy) {
    const commits = pathCommitsSince(idx, sinceSha, path)
    if (commits) return commits.length > 0
    return probe?.changed(sinceSha, path) ?? true
  }
  const anc = ancestorsOf(idx, sinceSha)
  if (anc) return (idx.fileCommits.get(path) ?? []).some((h) => !inAncestors(idx, anc, h))
  return probe?.changed(sinceSha, path) ?? true
}

// the code axis's DISPLAY detail: which governed files drifted since a reading, and by HOW MANY commits — so
// a stale eval can say "EvalsFeed.jsx +3" instead of a bare "code moved". Same DAG reachability as
// changedSince (a commit touching the file that is NOT an ancestor of the reading's sha lies in sinceSha..HEAD);
// an off-history sinceSha reports through the same content fallback (only files whose content differs, counted
// by rev-list); with no probe or a gone anchor it counts every touch (conservative, matching changedSince).
// Reporting only — it never decides freshness (staleAxes does); it explains a decision already made.
export function codeDrift(idx: DriftIndex, sinceSha: string, codeFiles: string[], probe?: ContentProbe): { file: string; behind: number }[] {
  if (idx.lazy) {
    const reachable = commitReachable(idx, sinceSha)
    const out: { file: string; behind: number }[] = []
    for (const file of codeFiles) {
      const commits = reachable ? pathCommitsSince(idx, sinceSha, file) ?? [] : []
      const differs = reachable ? undefined : probe?.changed(sinceSha, file)
      const behind = reachable ? commits.length
        : differs === true ? probe!.behind(sinceSha, file)
        : differs === false ? 0
        : 1
      if (behind > 0) out.push({ file, behind })
    }
    return out
  }
  const anc = ancestorsOf(idx, sinceSha)
  const out: { file: string; behind: number }[] = []
  for (const f of codeFiles) {
    const commits = idx.fileCommits.get(f) ?? []
    const differs = anc ? undefined : probe?.changed(sinceSha, f)
    const behind = anc ? commits.filter((h) => !inAncestors(idx, anc, h)).length
      : differs === true ? probe!.behind(sinceSha, f)
      : differs === false ? 0
      : commits.length
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
  if (didx.lazy) {
    const commits = pathCommitsSince(didx, sinceSha, evalPath)
    if (commits) {
      const after = new Set(commits)
      return scenarioChangeCommits(scIdx, evalPath, scenario).some((hash) => after.has(hash))
    }
    const differs = probe?.changed(sinceSha, evalPath)
    if (differs == null) return true
    if (!differs) return false
    return probe!.scenarioDiffers(sinceSha, evalPath, scenario)
  }
  const anc = ancestorsOf(didx, sinceSha)
  if (anc) return scenarioChangeCommits(scIdx, evalPath, scenario).some((h) => !inAncestors(didx, anc, h))
  const differs = probe?.changed(sinceSha, evalPath)
  if (differs == null) return true
  if (!differs) return false   // whole file byte-identical → this block too
  return probe!.scenarioDiffers(sinceSha, evalPath, scenario)
}

export function staleAxes(
  reading: Reading,
  codeFiles: string[],
  evalPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
  current?: Scenario,   // the scenario's CURRENT declaration (undefined = gone from eval.md) — the hash compare's other side
): StaleAxis[] {
  const axes: StaleAxis[] = []
  const byHash = scenarioStaleByHash(reading, current)
  if (probe && !commitReachable(didx, reading.codeSha) && !probe.canTestify(reading.codeSha)) {
    // the anchor commit object is GONE — neither git axis can testify; say that, not "content changed".
    // The stored contract hash needs no anchor, so it still decides the scenario axis when present.
    axes.push('anchor')
    if (byHash) axes.push('scenario')
  } else {
    if (codeFiles.some((f) => changedSince(didx, reading.codeSha, f, probe))) axes.push('code')
    if (byHash ?? scenarioMoved(scIdx, didx, reading.codeSha, evalPath, reading.scenario, probe)) axes.push('scenario')
  }
  if (remarkStale(reading, remarks)) axes.push('remark')
  return axes
}

export function isStale(
  reading: Reading,
  codeFiles: string[],
  evalPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
  current?: Scenario,
): boolean {
  return staleAxes(reading, codeFiles, evalPath, didx, scIdx, remarks, probe, current).length > 0
}
