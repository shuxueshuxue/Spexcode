import type { DriftIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'

// @@@ freshness - a reading measures the loss at ONE code-state; it goes STALE when the thing it measured
// moved. Three axes, exactly as [[spec-yatsu]] declares: a governed `code:` file changed, the SCENARIO
// (its yatsu.md) changed, or the EVALUATOR version moved — all "since the reading's codeSha".
//
// The code/scenario axes reuse the SAME git machinery as the lint drift check: the cached `DriftIndex`
// (its `pos` = commit → newest-first position, `fileCommits` = path → the commits that touched it). We do
// NOT use driftFor's Spec-OK ack logic — an ack vindicates a SPEC ("the spec still describes this code"),
// never a behavioral READING ("the measurement still holds"); a code change is a code change to a reading.
// No hashes are stored: freshness is derived live from git against the reading's recorded codeSha.

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

// @@@ staleAxes - which freshness axes a reading has fallen behind on (empty = fresh). The evaluator axis
// is the recorded tag versus the current version of that evaluator (an unknown evaluator invents none —
// see [[evaluator]]); the scenario axis is the yatsu.md moving, which already covers a scenario being
// renamed or dropped, so the scenario record itself is not needed here.
export function staleAxes(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  idx: DriftIndex,
): StaleAxis[] {
  const axes: StaleAxis[] = []
  if (codeFiles.some((f) => changedSince(idx, reading.codeSha, f))) axes.push('code')
  if (changedSince(idx, reading.codeSha, yatsuPath)) axes.push('scenario')
  if (isEvaluatorStale(reading.evaluator)) axes.push('evaluator')
  return axes
}

export function isStale(
  reading: Reading,
  codeFiles: string[],
  yatsuPath: string,
  idx: DriftIndex,
): boolean {
  return staleAxes(reading, codeFiles, yatsuPath, idx).length > 0
}
