import type { DriftIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import type { Scenario } from './yatsu.js'
import { driverFor, evaluatorTag } from './drivers.js'

// @@@ freshness - a reading reads the loss at ONE code-state; it goes STALE when the thing it measured
// moved. Three axes, exactly as [[spec-yatsu]] declares: a governed `code:` file changed, the SCENARIO
// (its yatsu.md) changed, or the EVALUATOR version moved — all "since the reading's codeSha".
//
// The code/scenario axes reuse the SAME git machinery as the lint drift check: the cached `DriftIndex`
// (its `pos` = commit → newest-first position, `fileCommits` = path → the commits that touched it). We do
// NOT use driftFor's Spec-OK ack logic — an ack vindicates a SPEC ("the spec still describes this code"),
// never a behavioral READING ("the pixels still match"); a code change is a code change to a reading.
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

// @@@ staleAxes - which freshness axes a reading has fallen behind on (empty = fresh). `scenario` may be
// undefined (the reading names a scenario the yatsu.md no longer declares); the yatsu.md change that
// removed it already trips the `scenario` axis, and with no driver to resolve, the evaluator axis is skipped.
export function staleAxes(
  reading: Reading,
  scenario: Scenario | undefined,
  codeFiles: string[],
  yatsuPath: string,
  idx: DriftIndex,
): StaleAxis[] {
  const axes: StaleAxis[] = []
  if (codeFiles.some((f) => changedSince(idx, reading.codeSha, f))) axes.push('code')
  if (changedSince(idx, reading.codeSha, yatsuPath)) axes.push('scenario')
  // evaluator axis: only when the scenario's driver is registered (an unbuilt future driver can't declare a
  // version, so we never invent staleness for it). Stale iff the live tag differs from the recorded one.
  const drv = scenario && driverFor(scenario.driver)
  if (drv && reading.evaluator !== evaluatorTag(drv)) axes.push('evaluator')
  return axes
}

export function isStale(
  reading: Reading,
  scenario: Scenario | undefined,
  codeFiles: string[],
  yatsuPath: string,
  idx: DriftIndex,
): boolean {
  return staleAxes(reading, scenario, codeFiles, yatsuPath, idx).length > 0
}
