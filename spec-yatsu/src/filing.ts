import { repoRoot, headSha } from '../../spec-cli/src/git.js'
import { yatsuNodes } from './yatsu.js'
import { appendReading, type Reading } from './sidecar.js'
import { putBlob } from './cache.js'

export type FileResult = { ok: true; reading: Reading } | { ok: false; error: string }

// the eval seam over DATA (no argv, no file paths): the dashboard annotator files a human measurement
// through the SAME append the CLI uses — one seam, two faces. Evidence arrives as text (the annotation
// report, which references the clip by hash) → a transcript blob in the same content-addressed cache;
// the evaluator is the human hand, manual@1. yatsu still runs nothing — this only records.
export function fileHumanReading(
  nodeId: string,
  input: { scenario: string; status: 'pass' | 'fail'; note?: string; transcript?: string },
): FileResult {
  const root = repoRoot()
  const node = yatsuNodes(root).find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: `no yatsu node '${nodeId}' (a node needs a yatsu.md)` }
  const sc = node.scenarios.find((s) => s.name === input.scenario)
  if (!sc) return { ok: false, error: `'${nodeId}' has no scenario '${input.scenario}'` }
  if (input.status !== 'pass' && input.status !== 'fail') return { ok: false, error: 'status must be pass or fail' }
  const blob = input.transcript ? putBlob(Buffer.from(input.transcript)) : null
  const reading: Reading = {
    scenario: sc.name,
    codeSha: headSha(root),
    blob,
    ...(blob ? { blobKind: 'transcript' as const } : {}),
    evaluator: 'manual@1',
    verdict: { status: input.status, ...(input.note ? { note: input.note } : {}) },
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  return { ok: true, reading }
}
