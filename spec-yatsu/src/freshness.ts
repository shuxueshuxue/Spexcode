import { rowsFor, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'

// the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has

export type StaleAxis = 'code' | 'scenario' | 'evaluator'

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
): StaleAxis[] {
  const axes: StaleAxis[] = []
  if (codeFiles.some((f) => changedSince(didx, reading.codeSha, f))) axes.push('code')
  if (scenarioMoved(hidx, didx.pos, reading.codeSha, yatsuPath)) axes.push('scenario')
  if (isEvaluatorStale(reading.evaluator)) axes.push('evaluator')
  return axes
}

export function isStale(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  didx: DriftIndex,
  hidx: HistoryIndex,
): boolean {
  return staleAxes(reading, codeFiles, yatsuPath, didx, hidx).length > 0
}
