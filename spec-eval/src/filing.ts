import { repoRoot, headSha } from '../../spec-cli/src/git.js'
import { evalNodes, resolveEvalNode, scenarioHash } from './scenarios.js'
import { appendReading, readReadings, isJsonBlob, type Reading, type EvidenceKind } from './sidecar.js'
import { putBlob } from './cache.js'

export type FileResult = { ok: true; reading: Reading } | { ok: false; error: string }

export function fileHumanReading(
  nodeId: string,
  input: { scenario: string; status: 'pass' | 'fail'; note?: string; transcript?: string; by?: string },
): FileResult {
  const root = repoRoot()
  const res = resolveEvalNode(evalNodes(root), nodeId)
  if (!res.ok) return { ok: false, error: res.error }
  const node = res.node
  const sc = node.scenarios.find((s) => s.name === input.scenario)
  if (!sc) return { ok: false, error: `'${nodeId}' has no scenario '${input.scenario}'` }
  if (input.status !== 'pass' && input.status !== 'fail') return { ok: false, error: 'status must be pass or fail' }
  const buf = input.transcript ? Buffer.from(input.transcript) : null
  const blob = buf ? putBlob(buf) : null
  const reading: Reading = {
    scenario: sc.name,
    codeSha: headSha(root),
    scenarioHash: scenarioHash(sc),
    ...(blob ? { evidence: [{ hash: blob, kind: (buf && isJsonBlob(buf) ? 'data' : 'transcript') as EvidenceKind }] } : {}),
    ...(input.by ? { by: input.by } : {}),
    verdict: { status: input.status, ...(input.note ? { note: input.note } : {}) },
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  return { ok: true, reading }
}

export function evalReadingFiler(nodeId: string, scenario: string, root: string = repoRoot()): string | null {
  const res = resolveEvalNode(evalNodes(root), nodeId)
  if (!res.ok) return null
  const forScenario = readReadings(res.node.sidecarPath).filter((r) => r.scenario === scenario)
  return forScenario.length ? forScenario[forScenario.length - 1].by ?? null : null
}
