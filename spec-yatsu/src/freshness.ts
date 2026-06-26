import { rowsFor, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import type { Reading } from './sidecar.js'
import { isEvaluatorStale } from './evaluator.js'

// @@@ freshness - a reading measures the loss at ONE code-state; it goes STALE when the thing it measured
// CHANGED. Three axes, exactly as [[spec-yatsu]] declares: a governed `code:` file changed, the SCENARIO
// (its yatsu.md) changed, or the EVALUATOR version moved — all "since the reading's codeSha".
//
// Both git axes reuse the SAME machinery as the spec side, so a reparent never reads as a change on either:
//   - CODE: the `DriftIndex` lint's drift check uses (`pos` = commit → newest-first position, `fileCommits`
//     = path → the commits that touched it). Touch-based — a code RENAME is out of scope (the same blind
//     spot lint's code-drift has; code files live outside the spec-tree history index).
//   - SCENARIO: the `HistoryIndex` a SPEC NODE's own freshness uses — content versions, rename-followed,
//     with pure-rename 0/0-diff commits dropped (`rowsFor`). So a bare `git mv` of the yatsu.md (a reparent)
//     is NOT a change, exactly as it isn't for a reparented spec node. This is the unification: one
//     content-version primitive (`rowsFor`) feeds both spec-node and scenario freshness — see scenarioMoved.
// We do NOT use driftFor's Spec-OK ack logic — an ack vindicates a SPEC ("the spec still describes this
// code"), never a behavioral READING ("the measurement still holds"); a code change is a code change to a
// reading. No hashes are stored: freshness is derived live from git against the reading's recorded codeSha.

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

// @@@ scenarioMoved - the SCENARIO freshness axis, rename-aware to MATCH how a spec node measures its own
// freshness. A reading goes stale when the scenario's CONTENT changed since its codeSha — NOT when a bare
// `git mv` reparented the yatsu.md. So it reuses `rowsFor` (the spec-tree content-version list: rename-
// followed, with pure-rename 0/0-diff commits already dropped) — the SAME primitive specs.ts uses for a
// node's versions — instead of the touch-based fileCommits, which counts a reparent as a change. `pos`
// (DriftIndex's global commit order) ranks those content versions against the reading; a content version
// newer than the reading (smaller pos) stales it. An off-history codeSha can't be proven fresh → stale.
function scenarioMoved(hidx: HistoryIndex, pos: Map<string, number>, sinceSha: string, yatsuPath: string): boolean {
  const sp = pos.get(sinceSha)
  if (sp === undefined) return true
  return rowsFor(hidx, yatsuPath).some((v) => { const p = pos.get(v.hash); return p !== undefined && p < sp })
}

// @@@ staleAxes - which freshness axes a reading has fallen behind on (empty = fresh). CODE is touch-based
// over the drift index (a code rename is out of scope — see the module note); SCENARIO is content-based and
// rename-safe (scenarioMoved); EVALUATOR is the recorded tag versus that evaluator's current version (an
// unknown evaluator invents none — see [[evaluator]]).
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
