// spec-reconstruction-bench executor registry ([[spec-reconstruction-bench]]).
//
// THE one place a phase gets an executor. Every row exposes the SAME launch(opts) → unified runner
// contract, so verify-model, R0 reconstruction and the O0/R0/N0 arms all go through one seam and
// enforceRunGates never learns which harness ran:
//   launch({ runId, snapshotDir, prompt, credPath, timeoutMs, archiveDir, upstreamCommit }) →
//   { ok, exitCode, timedOut, modelClean, realCompletion, accountingValid, apiError, secretClean,
//     quarantined?, trace, archiveDir, workDir, usage, durationMs }
// A batch pins ONE executor (the ledger's activeProvider unless explicitly overridden) and never mixes.
// The `fake` row is the no-model end-to-end control: same contract, same archive shape, zero network —
// it exists so verify→phase-gate wiring is testable before any paid call.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchAgent, MODEL as GLM_MODEL, ENDPOINT_HOST as GLM_ENDPOINT, provenanceRecord } from './sandbox.mjs'
import { launchCodex, CODEX_PROVIDER, codexProvenance } from './codex-adapter.mjs'

const HERE = new URL('.', import.meta.url).pathname

// ---- glm row: normalize sandbox.launchAgent's return onto the unified contract ----
async function launchGlm(opts) {
  const r = await launchAgent(opts)
  return {
    ok: r.ok, exitCode: r.exitCode, timedOut: r.timedOut,
    modelClean: r.modelClean, realCompletion: r.realCompletion, accountingValid: r.accountingValid,
    apiError: r.apiError ?? null, secretClean: r.secretClean, quarantined: r.quarantined ?? false,
    trace: r.trace, archiveDir: r.archiveDir, workDir: r.workDir,
    usage: r.trace?.tokens ?? null, durationMs: r.trace?.durationMs ?? null,
  }
}

// ---- fake row: deterministic, zero-network, SAME contract + archive shape (trace.json) ----
export const FAKE_PIN = Object.freeze({ providerName: 'fake-loop', model: 'fake-model-1', wireApi: 'none' })
async function launchFake(opts) {
  const { runId = 'fake-run', archiveDir, prompt = '', fakeKind = 'good' } = opts ?? {}
  if (!archiveDir) throw new Error('fake executor: archiveDir required')
  const t0 = Date.now()
  mkdirSync(archiveDir, { recursive: true })
  const bad = (k) => fakeKind === k
  const modelClean = !bad('bad-model')
  const realCompletion = !bad('no-completion')
  const secretClean = !bad('secret-hit')
  const exitCode = bad('nonzero-exit') ? 3 : 0
  const trace = {
    v: 1, runId, adapter: 'fake', started: new Date().toISOString(), ended: new Date().toISOString(), durationMs: Date.now() - t0,
    exitCode, timedOut: false, httpStatuses: [200], requestIds: ['req_fake_e2e'], threadIds: ['th_fake_e2e'],
    model: { observedSet: [modelClean ? FAKE_PIN.model : 'imposter-model'], expected: FAKE_PIN.model, clean: modelClean, realCompletion },
    usage: { input: 10, output: realCompletion ? 5 : 0, cached: 0, reasoning: 0 },
    apiError: null,
    provenance: { ...provenanceRecord(), adapter: 'fake' },
    secretScan: { keyHits: secretClean ? 0 : 1, prefixHits: 0, b64Hits: 0, scanner: 'fake', scanError: false, scannedFiles: 1, clean: secretClean },
  }
  writeFileSync(join(archiveDir, 'trace.json'), JSON.stringify(trace, null, 2) + '\n')
  writeFileSync(join(archiveDir, 'PROMPT.md'), String(prompt))
  const ok = exitCode === 0 && modelClean && realCompletion && secretClean
  return { ok, exitCode, timedOut: false, modelClean, realCompletion, accountingValid: true, apiError: null, secretClean, quarantined: false, trace, archiveDir, workDir: null, usage: trace.usage, durationMs: trace.durationMs }
}

// ---- the registry ----
export const EXECUTOR_REGISTRY = {
  glm: { name: 'glm', pin: Object.freeze({ providerName: 'bigmodel', model: GLM_MODEL, endpointHost: GLM_ENDPOINT }), launch: launchGlm, provenance: provenanceRecord },
  codex: { name: 'codex', pin: CODEX_PROVIDER, launch: launchCodex, provenance: codexProvenance },
  fake: { name: 'fake', pin: FAKE_PIN, launch: launchFake, provenance: provenanceRecord },
}

export function executorRow(name) {
  const row = EXECUTOR_REGISTRY[name]
  if (!row) throw new Error(`unknown executor '${name}' — registry rows: ${Object.keys(EXECUTOR_REGISTRY).join(', ')}`)
  return row
}

// the batch default comes from the frozen decision ledger's activeProvider — never a guess.
export function activeExecutorName({ ledgerPath = join(HERE, 'runs', 'pilot', 'ledger.json') } = {}) {
  if (!existsSync(ledgerPath)) throw new Error(`no decision ledger at ${ledgerPath} — pass --executor explicitly`)
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const name = ledger.activeProvider
  if (!name) throw new Error(`decision ledger ${ledgerPath} has no activeProvider — pass --executor explicitly`)
  return executorRow(name).name
}
