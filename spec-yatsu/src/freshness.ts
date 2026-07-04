import { rowsFor, ancestorsOf, inAncestors, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'evaluator' | 'remark'

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
// branchy history). ONE conservative rule for an off-history `sinceSha` — whether rebased away (orphan)
// or on a reachable-but-unmerged branch: we can't prove freshness from HEAD's history, so it reads
// stale rather than silently pass.
export function changedSince(idx: DriftIndex, sinceSha: string, path: string): boolean {
  const anc = ancestorsOf(idx, sinceSha)
  if (!anc) return true
  return (idx.fileCommits.get(path) ?? []).some((h) => !inAncestors(idx, anc, h))
}

// the code axis's DISPLAY detail: which governed files drifted since a reading, and by HOW MANY commits — so
// a stale eval can say "EvalsFeed.jsx +3" instead of a bare "code moved". Same DAG reachability as
// changedSince (a commit touching the file that is NOT an ancestor of the reading's sha lies in sinceSha..HEAD);
// an off-history sinceSha counts every touch (conservative, matching changedSince's stale-rather-than-pass rule).
// Reporting only — it never decides freshness (staleAxes does); it explains a decision already made.
export function codeDrift(idx: DriftIndex, sinceSha: string, codeFiles: string[]): { file: string; behind: number }[] {
  const anc = ancestorsOf(idx, sinceSha)
  const out: { file: string; behind: number }[] = []
  for (const f of codeFiles) {
    const commits = idx.fileCommits.get(f) ?? []
    const behind = anc ? commits.filter((h) => !inAncestors(idx, anc, h)).length : commits.length
    if (behind > 0) out.push({ file: f, behind })
  }
  return out
}

// scenario freshness uses rowsFor (rename-followed content versions, like a spec node), not touch-based fileCommits, so a bare git-mv reparent isn't a change; off-history codeSha → stale
function scenarioMoved(hidx: HistoryIndex, didx: DriftIndex, sinceSha: string, yatsuPath: string): boolean {
  const anc = ancestorsOf(didx, sinceSha)
  if (!anc) return true
  return rowsFor(hidx, yatsuPath).some((v) => !inAncestors(didx, anc, v.hash))
}

export function staleAxes(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  didx: DriftIndex,
  hidx: HistoryIndex,
  remarks: RemarkSignal[] = [],
): StaleAxis[] {
  const axes: StaleAxis[] = []
  if (codeFiles.some((f) => changedSince(didx, reading.codeSha, f))) axes.push('code')
  if (scenarioMoved(hidx, didx, reading.codeSha, yatsuPath)) axes.push('scenario')
  if (isEvaluatorStale(reading.evaluator)) axes.push('evaluator')
  if (remarkStale(reading, remarks)) axes.push('remark')
  return axes
}

export function isStale(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  didx: DriftIndex,
  hidx: HistoryIndex,
  remarks: RemarkSignal[] = [],
): boolean {
  return staleAxes(reading, codeFiles, yatsuPath, didx, hidx, remarks).length > 0
}
