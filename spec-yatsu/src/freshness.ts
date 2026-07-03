import { rowsFor, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'evaluator' | 'remark'

// the REMARK axis's input ([[remark-teeth]]): the teeth read only the resolvable bit + when it was resolved,
// not the whole remark — so freshness stays a PURE function, fed the scenario's remark track at the call
// sites (never reaching into the forum). One signal per remark on the (node, scenario).
export type RemarkSignal = { resolved: boolean; resolvedAt?: string }

// the teeth (T1): a scenario is remark-stale unless EVERY remark is resolved AND this reading post-dates
// every resolution. So an UNRESOLVED remark ages it; a RESOLVED remark keeps it stale until a reading taken
// strictly after the resolve (reading.ts > resolvedAt) exists — you can't out-run a remark by re-measuring
// before the resolve, nor clear it by passive receipt. A resolved bit with no timestamp stays conservatively
// stale (defensive: resolveRemark always stamps one).
export function remarkStale(reading: { ts: string }, remarks: RemarkSignal[]): boolean {
  return remarks.some((r) => !r.resolved || !(r.resolvedAt && reading.ts > r.resolvedAt))
}

// true iff some commit touched `path` strictly NEWER than `sinceSha`. An unknown `sinceSha` (a reading
// taken off the current history — e.g. on a since-rebased commit) returns true: we can't prove freshness,
// so we treat it as stale rather than silently pass.
export function changedSince(idx: DriftIndex, sinceSha: string, path: string): boolean {
  const sp = idx.pos.get(sinceSha)
  if (sp === undefined) return true
  for (const h of idx.fileCommits.get(path) ?? []) {
    const p = idx.pos.get(h)
    if (p !== undefined && p < sp) return true   // smaller position = newer than the reading
  }
  return false
}

// scenario freshness uses rowsFor (rename-followed content versions, like a spec node), not touch-based fileCommits, so a bare git-mv reparent isn't a change; off-history codeSha → stale
function scenarioMoved(hidx: HistoryIndex, pos: Map<string, number>, sinceSha: string, yatsuPath: string): boolean {
  const sp = pos.get(sinceSha)
  if (sp === undefined) return true
  return rowsFor(hidx, yatsuPath).some((v) => { const p = pos.get(v.hash); return p !== undefined && p < sp })
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
  if (scenarioMoved(hidx, didx.pos, reading.codeSha, yatsuPath)) axes.push('scenario')
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
