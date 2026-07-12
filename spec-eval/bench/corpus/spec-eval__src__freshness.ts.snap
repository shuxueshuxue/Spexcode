import { git, headSha, ancestorsOf, inAncestors, type DriftIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { scenarioHash, type Scenario } from './scenarios.js'
import { scenarioChangeCommits, scenarioBlocksAt, type ScenarioIndex } from './scenariofresh.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'remark' | 'anchor'

// @@@ off-history content fallback - ancestry can't testify for a codeSha that isn't reachable from HEAD
// (fold/rebase/squash-merge/cherry-pick all orphan the anchor), but the TREES still can: while the anchor
// commit object exists locally, `git diff <anchor> HEAD` names exactly the paths whose content differs, so
// a history rewrite that left governed content byte-identical reads FRESH instead of false-positive stale.
// The probe is fed at the call sites (like the remark track) so the decision functions stay pure over their
// inputs and the in-history fast path pays no extra git call; only when the commit object is truly gone
// (gc'd orphan) does the conservative rule remain — surfaced as the 'anchor' axis, so "anchor lost" reads
// differently from "content moved". No probe fed → the old always-conservative rule.
export type ContentProbe = {
  // paths whose content differs between the anchor commit's tree and HEAD's; null = anchor object gone
  changedPaths(anchorSha: string): Set<string> | null
  // did THIS scenario's semantic block (description+expected) move between anchor and HEAD ([[scenariofresh]])
  scenarioDiffers(anchorSha: string, evalPath: string, scenario: string): boolean
  // codeDrift's display detail: commits in anchor..HEAD touching path (floored at 1 — the content differs)
  behind(anchorSha: string, path: string): number
}

// (anchor, HEAD) name two immutable trees, so entries never invalidate; the LRU only bounds memory,
// sized above the largest adopter reading corpus — one entry per (reading, path) worst case — so a
// repeat board build never thrashes back into forking (a bound below the corpus's distinct key count
// turns a fixed-order rebuild into sequential thrash: every pass evicts the whole memo before cycling
// back, re-forking one git child per key forever — scenariofresh's oidMemo sizing rule).
const diffMemo = new Map<string, Set<string> | null>()
const behindMemo = new Map<string, number>()
function memo<V>(m: Map<string, V>, k: string, build: () => V): V {
  if (m.has(k)) { const v = m.get(k)!; m.delete(k); m.set(k, v); return v }
  const v = build()
  m.set(k, v)
  if (m.size > 4096) m.delete(m.keys().next().value!)
  return v
}

export function contentProbeFor(root: string): ContentProbe {
  let head: string | undefined
  const headOf = () => (head ??= headSha(root))
  return {
    changedPaths(sha) {
      return memo(diffMemo, `${root}\x1f${sha}\x1f${headOf()}`, () => {
        try {
          return new Set(git(['-C', root, '-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', sha, headOf()])
            .split('\n').map((s) => s.trim()).filter(Boolean))
        } catch { return null }   // the anchor commit object is gone — content can't testify
      })
    },
    scenarioDiffers(sha, evalPath, scenario) {
      const a = scenarioBlocksAt(root, sha, evalPath)
      if (!a) return true   // eval.md unreadable at the anchor (renamed/absent) → can't prove → stale
      return a.get(scenario) !== scenarioBlocksAt(root, headOf(), evalPath)?.get(scenario)
    },
    behind(sha, path) {
      return memo(behindMemo, `${root}\x1f${sha}\x1f${headOf()}\x1f${path}`, () => {
        try {
          const n = Number(git(['-C', root, 'rev-list', '--count', `${sha}..${headOf()}`, '--', path]).trim())
          return Number.isFinite(n) && n > 0 ? n : 1
        } catch { return 1 }
      })
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
  const anc = ancestorsOf(idx, sinceSha)
  if (anc) return (idx.fileCommits.get(path) ?? []).some((h) => !inAncestors(idx, anc, h))
  const diff = probe?.changedPaths(sinceSha)
  return diff ? diff.has(path) : true
}

// the code axis's DISPLAY detail: which governed files drifted since a reading, and by HOW MANY commits — so
// a stale eval can say "EvalsFeed.jsx +3" instead of a bare "code moved". Same DAG reachability as
// changedSince (a commit touching the file that is NOT an ancestor of the reading's sha lies in sinceSha..HEAD);
// an off-history sinceSha reports through the same content fallback (only files whose content differs, counted
// by rev-list); with no probe or a gone anchor it counts every touch (conservative, matching changedSince).
// Reporting only — it never decides freshness (staleAxes does); it explains a decision already made.
export function codeDrift(idx: DriftIndex, sinceSha: string, codeFiles: string[], probe?: ContentProbe): { file: string; behind: number }[] {
  const anc = ancestorsOf(idx, sinceSha)
  const diff = anc ? undefined : probe?.changedPaths(sinceSha)
  const out: { file: string; behind: number }[] = []
  for (const f of codeFiles) {
    const commits = idx.fileCommits.get(f) ?? []
    const behind = anc ? commits.filter((h) => !inAncestors(idx, anc, h)).length
      : diff ? (diff.has(f) ? probe!.behind(sinceSha, f) : 0)
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
  const anc = ancestorsOf(didx, sinceSha)
  if (anc) return scenarioChangeCommits(scIdx, evalPath, scenario).some((h) => !inAncestors(didx, anc, h))
  const diff = probe?.changedPaths(sinceSha)
  if (!diff) return true
  if (!diff.has(evalPath)) return false   // whole file byte-identical → this block too
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
  if (probe && !ancestorsOf(didx, reading.codeSha) && probe.changedPaths(reading.codeSha) === null) {
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
