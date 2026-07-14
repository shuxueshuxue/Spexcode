// no-model registry E2E ([[spec-reconstruction-bench]]): the fake executor row exercises the EXACT
// verify→phase-gate path the paid phase uses — same registry, same verifyModel writer, same
// verifyAdmitted predicate — proving the wiring before any paid call.
//   run: node --import tsx spec-eval/bench/reconstruction/registry.selftest.mjs   (exit 0 = pass)
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EXECUTOR_REGISTRY, executorRow, activeExecutorName, FAKE_PIN } from './registry.mjs'
import { verifyModel, verifyAdmitted } from './pilot.mjs'
import { provenanceRecord } from './sandbox.mjs'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }

// registry shape: every row exposes the same seam
for (const [name, row] of Object.entries(EXECUTOR_REGISTRY)) {
  check(`row-${name}-shape`, row.name === name && !!row.pin && typeof row.launch === 'function' && typeof row.provenance === 'function')
}
let unk = false; try { executorRow('nope') } catch { unk = true } check('unknown-executor-throws', unk)
check('ledger-active-provider', activeExecutorName() === 'codex')   // frozen decision: BigModel retired

// fake row honors the UNIFIED runner contract end to end (archive + trace.json + all gate fields)
const tmp = mkdtempSync(join(tmpdir(), 'srb-registry-'))
const CONTRACT = ['ok', 'exitCode', 'timedOut', 'modelClean', 'realCompletion', 'accountingValid', 'apiError', 'secretClean', 'trace', 'archiveDir', 'workDir', 'usage', 'durationMs']
try {
  const r = await executorRow('fake').launch({ runId: 'e2e-good', archiveDir: join(tmp, 'good'), prompt: 'p' })
  check('fake-contract-fields', CONTRACT.every((k) => k in r), CONTRACT.filter((k) => !(k in r)).join(','))
  check('fake-good-ok', r.ok === true && r.modelClean === true && r.trace.model.expected === FAKE_PIN.model)
  check('fake-archives-trace', existsSync(join(tmp, 'good', 'trace.json')))
  const bad = await executorRow('fake').launch({ runId: 'e2e-bad', archiveDir: join(tmp, 'bad'), prompt: 'p', fakeKind: 'bad-model' })
  check('fake-bad-model-fails-contract', bad.ok === false && bad.modelClean === false)

  // verify→gate E2E: verifyModel (the real writer) → verify.json → verifyAdmitted (the real gate)
  const prov = provenanceRecord()
  await verifyModel({ credPath: '/nonexistent', executor: 'fake', outDir: join(tmp, 'out-good') })
  const vGood = JSON.parse(readFileSync(join(tmp, 'out-good', 'verify-model', 'verify.json'), 'utf8'))
  check('verify-json-normalized', vGood.executor === 'fake' && vGood.ok === true && vGood.pin.model === FAKE_PIN.model && !!vGood.provenance)
  check('gate-admits-matching-verify', verifyAdmitted(vGood, { executor: 'fake', prov }).ok === true)
  const mix = verifyAdmitted(vGood, { executor: 'codex', prov })
  check('gate-rejects-executor-mix', mix.ok === false && mix.why.some((w) => /no mixing/.test(w)))
  check('gate-rejects-missing-verify', verifyAdmitted(null, { executor: 'fake' }).ok === false)
  check('gate-rejects-provenance-mismatch', verifyAdmitted(vGood, { executor: 'fake', prov: { ...prov, runnerCommit: 'other' } }).ok === false)

  await verifyModel({ credPath: '/nonexistent', executor: 'fake', fakeKind: 'bad-model', outDir: join(tmp, 'out-bad') })
  const vBad = JSON.parse(readFileSync(join(tmp, 'out-bad', 'verify-model', 'verify.json'), 'utf8'))
  check('gate-rejects-failed-verify', verifyAdmitted(vBad, { executor: 'fake', prov }).ok === false)
  await verifyModel({ credPath: '/nonexistent', executor: 'fake', fakeKind: 'no-completion', outDir: join(tmp, 'out-nc') })
  const vNc = JSON.parse(readFileSync(join(tmp, 'out-nc', 'verify-model', 'verify.json'), 'utf8'))
  check('gate-rejects-no-completion', verifyAdmitted(vNc, { executor: 'fake', prov }).ok === false)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(failed ? `\nREGISTRY SELFTEST FAILED (${failed})` : '\nregistry selftest ✓ fake row covers verify→phase-gate end to end (no model call)')
process.exit(failed ? 1 : 0)
