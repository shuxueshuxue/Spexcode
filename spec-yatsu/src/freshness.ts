import { git, headSha, ancestorsOf, inAncestors, type DriftIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'
import { scenarioChangeCommits, scenarioBlocksAt, type ScenarioIndex } from './scenariofresh.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'evaluator' | 'remark' | 'anchor'

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
  scenarioDiffers(anchorSha: string, yatsuPath: string, scenario: string): boolean
  // codeDrift's display detail: commits in anchor..HEAD touching path (floored at 1 — the content differs)
  behind(anchorSha: string, path: string): number
}

// (anchor, HEAD) name two immutable trees, so entries never invalidate; the LRU only bounds memory.
const diffMemo = new Map<string, Set<string> | null>()
const behindMemo = new Map<string, number>()
function memo<V>(m: Map<string, V>, k: string, build: () => V): V {
  if (m.has(k)) { const v = m.get(k)!; m.delete(k); m.set(k, v); return v }
  const v = build()
  m.set(k, v)
  if (m.size > 512) m.delete(m.keys().next().value!)
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
    scenarioDiffers(sha, yatsuPath, scenario) {
      const a = scenarioBlocksAt(root, sha, yatsuPath)
      if (!a) return true   // yatsu.md unreadable at the anchor (renamed/absent) → can't prove → stale
      return a.get(scenario) !== scenarioBlocksAt(root, headOf(), yatsuPath)?.get(scenario)
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

// scenario freshness is PER-SCENARIO and SEMANTIC, not per-file: a reading stales only when ITS OWN
// scenario's semantic block (description+expected — [[scenariofresh]]'s blockContent projection) moved in
// scenarioSha..HEAD — never when a sibling in the same yatsu.md did, and never on a metadata-only edit
// (tags/test/code/related). Reads exactly like the code axis's changedSince — the per-scenario
// change-commits ([[scenariofresh]], rename-followed so a bare git-mv reparent isn't a change) tested for
// ancestry — and an off-history codeSha takes the same content fallback at the same granularity and the
// same projection: an unchanged yatsu.md clears it outright, a changed one stales only if THIS scenario's
// semantic block differs between the anchor and HEAD.
function scenarioMoved(scIdx: ScenarioIndex, didx: DriftIndex, sinceSha: string, yatsuPath: string, scenario: string, probe?: ContentProbe): boolean {
  const anc = ancestorsOf(didx, sinceSha)
  if (anc) return scenarioChangeCommits(scIdx, yatsuPath, scenario).some((h) => !inAncestors(didx, anc, h))
  const diff = probe?.changedPaths(sinceSha)
  if (!diff) return true
  if (!diff.has(yatsuPath)) return false   // whole file byte-identical → this block too
  return probe!.scenarioDiffers(sinceSha, yatsuPath, scenario)
}

export function staleAxes(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
): StaleAxis[] {
  const axes: StaleAxis[] = []
  if (probe && !ancestorsOf(didx, reading.codeSha) && probe.changedPaths(reading.codeSha) === null) {
    // the anchor commit object is GONE — neither git axis can testify; say that, not "content changed"
    axes.push('anchor')
  } else {
    if (codeFiles.some((f) => changedSince(didx, reading.codeSha, f, probe))) axes.push('code')
    if (scenarioMoved(scIdx, didx, reading.codeSha, yatsuPath, reading.scenario, probe)) axes.push('scenario')
  }
  if (isEvaluatorStale(reading.evaluator)) axes.push('evaluator')
  if (remarkStale(reading, remarks)) axes.push('remark')
  return axes
}

export function isStale(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  didx: DriftIndex,
  scIdx: ScenarioIndex,
  remarks: RemarkSignal[] = [],
  probe?: ContentProbe,
): boolean {
  return staleAxes(reading, codeFiles, yatsuPath, didx, scIdx, remarks, probe).length > 0
}
