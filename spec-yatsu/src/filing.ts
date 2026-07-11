import { repoRoot, headSha } from '../../spec-cli/src/git.js'
import { yatsuNodes, resolveYatsuNode } from './yatsu.js'
import { appendReading, readReadings, isJsonBlob, type Reading, type EvidenceKind } from './sidecar.js'
import { putBlob } from './cache.js'

export type FileResult = { ok: true; reading: Reading } | { ok: false; error: string }

// the eval seam over DATA (no argv, no file paths): a caller with a verdict in hand — the HTTP eval route,
// a programmatic filer — appends through the SAME seam the CLI uses. Optional evidence arrives as text (a
// report referencing the clip by hash) → a transcript blob in the same content-addressed cache. yatsu
// still runs nothing — this only records. The dashboard files nothing through this: [[event-detail]] is
// read-side on readings.
export function fileHumanReading(
  nodeId: string,
  input: { scenario: string; status: 'pass' | 'fail'; note?: string; transcript?: string; by?: string },
): FileResult {
  const root = repoRoot()
  // the same loud resolution the CLI applies ([[yatsu-core]]): exact canonical id, else a unique bare
  // leaf; an ambiguous leaf returns the candidate list instead of filing against an arbitrary node.
  const res = resolveYatsuNode(yatsuNodes(root), nodeId)
  if (!res.ok) return { ok: false, error: res.error }
  const node = res.node
  const sc = node.scenarios.find((s) => s.name === input.scenario)
  if (!sc) return { ok: false, error: `'${nodeId}' has no scenario '${input.scenario}'` }
  if (input.status !== 'pass' && input.status !== 'fail') return { ok: false, error: 'status must be pass or fail' }
  // the evidence bytes; its kind is derived from CONTENT ([[evidence-kind-taxonomy]]) — a structured JSON
  // export files as `data`, free-form text as `transcript` — so the HTTP filer agrees with the CLI.
  const buf = input.transcript ? Buffer.from(input.transcript) : null
  const blob = buf ? putBlob(buf) : null
  const reading: Reading = {
    scenario: sc.name,
    codeSha: headSha(root),
    ...(blob ? { evidence: [{ hash: blob, kind: (buf && isJsonBlob(buf) ? 'data' : 'transcript') as EvidenceKind }] } : {}),
    // the filing session (caller-passed — the human annotator has no reachable session, so it stays absent
    // there and the eval-comment loop-in is silent, per [[mentions]])
    ...(input.by ? { by: input.by } : {}),
    verdict: { status: input.status, ...(input.note ? { note: input.note } : {}) },
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  return { ok: true, reading }
}

// The session that filed the LATEST reading for (node, scenario) — the ORIGINATOR an eval-comment thread
// loops in on a reply ([[mentions]] implicit loop-in). Null when the node/scenario has no reading, or the
// latest reading is legacy (no `by`). Store-agnostic: the caller resolves this id to a live session or nobody.
// `root` defaults to the trunk; the loop-in chain also passes each LIVE session's worktree here, because an
// in-flight reading (filed on an unmerged branch) is invisible to the trunk sidecar — exactly the
// review-time case where the remark must still reach its filer ([[remark-polish]] strand 2).
export function evalReadingFiler(nodeId: string, scenario: string, root: string = repoRoot()): string | null {
  const res = resolveYatsuNode(yatsuNodes(root), nodeId)
  if (!res.ok) return null
  const forScenario = readReadings(res.node.sidecarPath).filter((r) => r.scenario === scenario)
  return forScenario.length ? forScenario[forScenario.length - 1].by ?? null : null
}
