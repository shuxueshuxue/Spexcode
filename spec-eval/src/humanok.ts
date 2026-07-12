import { relative } from 'node:path'
import { repoRoot } from '../../spec-cli/src/git.js'
import { commitTrunkData } from '../../spec-cli/src/localIssues.js'
import { evalNodes, resolveEvalNode } from './scenarios.js'
import { readReadings, readSidecar, appendHumanOk, humanOkFor, type HumanOk } from './sidecar.js'

// @@@ human-ok - the human sign-off on an eval reading ([[human-ok]]). One write, both surfaces: the CLI
// (`spex eval ok`) and the HTTP route (`POST /api/specs/:id/evals/ok`, identity server-derived 'human')
// call THIS. The ok binds to ONE immutable reading — the scenario's latest effective reading at ok-time,
// anchored by its (ts, codeSha) — and is MONOTONIC: no un-ok verb exists, because a newer reading is a
// different object the ok never transfers to, and staleness is computed live; both bring the scenario back
// on their own. Durability follows the checkout: on the trunk checkout the append is committed straight to
// trunk (`--no-verify`, path-scoped, under the shared store lock — the [[local-issues]] discipline,
// commitTrunkData); on a linked worktree the append stays in that tree and the session's own ritual commit
// carries it, exactly like every other sidecar write.
export type OkResult =
  | { ok: true; humanOk: HumanOk; already: boolean; landed: 'committed' | 'uncommitted' }
  | { ok: false; error: string }

export function fileHumanOk(nodeId: string, scenario: string, by: string): OkResult {
  const root = repoRoot()
  // the same loud resolution every eval verb applies ([[eval-core]]): exact canonical id, else a unique
  // bare leaf; an ambiguous leaf returns the candidate list instead of blessing an arbitrary node.
  const res = resolveEvalNode(evalNodes(root), nodeId)
  if (!res.ok) return { ok: false, error: res.error }
  const node = res.node
  if (!node.scenarios.some((s) => s.name === scenario) &&
      !readSidecar(node.sidecarPath).readings.some((r) => r.scenario === scenario))
    return { ok: false, error: `'${node.id}' has no scenario '${scenario}'` }
  // the ok's one possible target: the latest EFFECTIVE reading — an ok is a judgment on a measurement that
  // exists and currently counts; an unmeasured (or fully-retracted) scenario has nothing to bless.
  const forScenario = readReadings(node.sidecarPath).filter((r) => r.scenario === scenario)
  if (!forScenario.length) return { ok: false, error: `'${node.id}' scenario '${scenario}' has no effective reading — nothing to ok` }
  const latest = forScenario[forScenario.length - 1]
  // a duplicate ok is idempotent success (the store already IS the requested state — the local-issue
  // close's `already` semantics), never an error and never a second appended row.
  const existing = humanOkFor(readSidecar(node.sidecarPath).oks, scenario, latest.ts)
  if (existing) return { ok: true, humanOk: existing, already: true, landed: 'committed' }
  const row: HumanOk = { kind: 'human-ok', scenario, okTs: latest.ts, okSha: latest.codeSha, by, ts: new Date().toISOString() }
  appendHumanOk(node.sidecarPath, row)
  const landed = commitTrunkData(relative(root, node.sidecarPath), `eval(${node.id}): human-ok '${scenario}' @ ${latest.ts} by ${by}`)
  return { ok: true, humanOk: row, already: false, landed: landed === 'not-primary' ? 'uncommitted' : 'committed' }
}
