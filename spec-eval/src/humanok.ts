import { relative } from 'node:path'
import { repoRoot } from '../../spec-cli/src/git.js'
import { commitTrunkData } from '../../spec-cli/src/localIssues.js'
import { evalNodes, resolveEvalNode } from './scenarios.js'
import { readReadings, readSidecar, appendHumanOk, humanOkFor, type HumanOk } from './sidecar.js'

export type OkResult =
  | { ok: true; humanOk: HumanOk; already: boolean; landed: 'committed' | 'uncommitted' }
  | { ok: false; error: string }

export function fileHumanOk(nodeId: string, scenario: string, by: string): OkResult {
  const root = repoRoot()
  const res = resolveEvalNode(evalNodes(root), nodeId)
  if (!res.ok) return { ok: false, error: res.error }
  const node = res.node
  if (!node.scenarios.some((s) => s.name === scenario) &&
      !readSidecar(node.sidecarPath).readings.some((r) => r.scenario === scenario))
    return { ok: false, error: `'${node.id}' has no scenario '${scenario}'` }
  const forScenario = readReadings(node.sidecarPath).filter((r) => r.scenario === scenario)
  if (!forScenario.length) return { ok: false, error: `'${node.id}' scenario '${scenario}' has no effective eval — nothing to ok` }
  const latest = forScenario[forScenario.length - 1]
  const existing = humanOkFor(readSidecar(node.sidecarPath).oks, scenario, latest.ts)
  if (existing) return { ok: true, humanOk: existing, already: true, landed: 'committed' }
  const row: HumanOk = { kind: 'human-ok', scenario, okTs: latest.ts, okSha: latest.codeSha, by, ts: new Date().toISOString() }
  appendHumanOk(node.sidecarPath, row)
  const landed = commitTrunkData(relative(root, node.sidecarPath), `eval(${node.id}): human-ok '${scenario}' @ ${latest.ts} by ${by}`)
  return { ok: true, humanOk: row, already: false, landed: landed === 'not-primary' ? 'uncommitted' : 'committed' }
}
