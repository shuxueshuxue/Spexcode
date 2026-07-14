// no-model registry E2E ([[spec-reconstruction-bench]]): the fake executor row exercises the EXACT
// verify→phase-gate path the paid phase uses — same registry, same verifyModel writer, same
// verifyAdmitted predicate — proving the wiring before any paid call.
//   run: node --import tsx spec-eval/bench/reconstruction/registry.selftest.mjs   (exit 0 = pass)
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
import { EXECUTOR_REGISTRY, executorRow, activeExecutorName, FAKE_PIN } from './registry.mjs'
import { verifyModel, verifyAdmitted, buildLeafSchedule, runSchedule } from './pilot.mjs'
import { provenanceRecord } from './sandbox.mjs'
import { assertZeroCodexResidue } from './codex-adapter.mjs'
import { mkdirSync, writeFileSync as wf } from 'node:fs'

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
  const rGood = await verifyModel({ credPath: '/nonexistent', executor: 'fake', outDir: join(tmp, 'out-good') })
  const vGood = rGood.verify
  check('verify-json-normalized', vGood.executor === 'fake' && vGood.ok === true && vGood.pin.model === FAKE_PIN.model && !!vGood.provenance && !!vGood.archiveDir)
  check('gate-admits-matching-verify', verifyAdmitted(vGood, { executor: 'fake', prov }).ok === true)
  const mix = verifyAdmitted(vGood, { executor: 'codex', prov })
  check('gate-rejects-executor-mix', mix.ok === false && mix.why.some((w) => /no mixing/.test(w)))
  check('gate-rejects-missing-verify', verifyAdmitted(null, { executor: 'fake' }).ok === false)
  check('gate-rejects-provenance-mismatch', verifyAdmitted(vGood, { executor: 'fake', prov: { ...prov, runnerCommit: 'other' } }).ok === false)

  const rBad = await verifyModel({ credPath: '/nonexistent', executor: 'fake', fakeKind: 'bad-model', outDir: join(tmp, 'out-bad') })
  check('gate-rejects-failed-verify', verifyAdmitted(rBad.verify, { executor: 'fake', prov }).ok === false)
  const rNc = await verifyModel({ credPath: '/nonexistent', executor: 'fake', fakeKind: 'no-completion', outDir: join(tmp, 'out-nc') })
  check('gate-rejects-no-completion', verifyAdmitted(rNc.verify, { executor: 'fake', prov }).ok === false)

  // (2) UNIQUE gate archives: every attempt gets a fresh verify-model-<executor>-<stamp> dir; verify.json
  // names its exact archive; the gate-ledger points at it; latestVerify resolves the newest per executor.
  const outU = join(tmp, 'out-unique')
  const u1 = await verifyModel({ credPath: '/nonexistent', executor: 'fake', outDir: outU })
  const u2 = await verifyModel({ credPath: '/nonexistent', executor: 'fake', outDir: outU })
  check('gate-archive-unique-per-attempt', u1.verify.archiveDir !== u2.verify.archiveDir && existsSync(u1.verify.archiveDir) && existsSync(u2.verify.archiveDir))
  check('verify-json-names-exact-archive', u2.verify.archiveDir.includes('verify-model-fake-') && JSON.parse(readFileSync(join(u2.verify.archiveDir, 'verify.json'), 'utf8')).archiveDir === u2.verify.archiveDir)
  const ledgerRows = readFileSync(join(outU, 'gate-ledger.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check('gate-ledger-points-at-archives', ledgerRows.length === 2 && ledgerRows[0].archiveDir === u1.verify.archiveDir && ledgerRows[1].archiveDir === u2.verify.archiveDir && ledgerRows.every((r) => r.executor === 'fake'))
  const { latestVerify } = await import('./pilot.mjs')
  check('latest-verify-provider-scoped-newest', latestVerify('fake', outU)?.archiveDir === u2.verify.archiveDir && latestVerify('codex', outU) === null)

  // (1) one-shot reviewer authorization: the flag reaches the row only via verifyModel; a Codex gate
  // WITHOUT it refuses before any auth read or network touch; the flag propagates when given.
  let codexBlocked = null
  try { await verifyModel({ credPath: '/nonexistent', executor: 'codex', outDir: join(tmp, 'out-codex') }) } catch (e) { codexBlocked = String(e.message) }
  check('codex-verify-without-go-refuses-pre-auth', !!codexBlocked && /BLOCKED/.test(codexBlocked), codexBlocked ?? 'did not throw')
  const rGo = await verifyModel({ credPath: '/nonexistent', executor: 'fake', reviewerGo: true, outDir: join(tmp, 'out-go') })
  const rNoGo = await verifyModel({ credPath: '/nonexistent', executor: 'fake', outDir: join(tmp, 'out-nogo') })
  check('reviewer-go-propagates-to-row', rGo.trace.reviewerGoReceived === true && rNoGo.trace.reviewerGoReceived === false)
  // the phase CLI refuses the flag outright (authorization is the admitted-verify capability, never a flag)
  let phaseRc = 0
  try { execFileSync(process.execPath, [join(HERE, 'pilot.mjs'), 'phase', '--reviewer-go'], { encoding: 'utf8', stdio: 'pipe' }) } catch (e) { phaseRc = e.status }
  check('phase-cli-rejects-reviewer-go-flag', phaseRc === 2, `rc=${phaseRc}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ---- SERIAL-FIRST scheduler: concurrency=1, frozen flattened order, first failure stops the rest ----
const tasksFrozen = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'))
const sched = buildLeafSchedule(tasksFrozen)
const expect = [
  'recon:spec-lint', 'recon:mobile-ui',
  'arm:0:O0', 'arm:1:R0', 'arm:2:N0',   // position 0 across the three frozen block rotations
  'arm:0:R0', 'arm:1:N0', 'arm:2:O0',   // position 1
  'arm:0:N0', 'arm:1:O0', 'arm:2:R0',   // position 2
]
const got = sched.map((s) => s.kind === 'recon' ? `recon:${s.leafId}` : `arm:${s.block}:${s.arm}`)
check('schedule-frozen-flattened-order', JSON.stringify(got) === JSON.stringify(expect), JSON.stringify(got))

// maxInFlight==1 + executed sequence == schedule + pid zero residue after every launch
{
  const residueRoot = mkdtempSync(join(tmpdir(), 'srb-serial-'))
  let inFlight = 0, maxInFlight = 0
  const order = []
  const abort = { stopped: false, reason: null }
  const { executed, failures } = await runSchedule(sched, async (step) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
    const scratch = join(residueRoot, `srb-codex-${process.pid}-step${step.seq}`)
    mkdirSync(scratch); wf(join(scratch, 'codex.env'), 'x')
    await new Promise((r) => setTimeout(r, 5))
    rmSync(scratch, { recursive: true })
    assertZeroCodexResidue({ tmpRoot: residueRoot })   // pid-level assert holds after EVERY launch
    order.push(step.seq)
    inFlight--
  }, abort)
  rmSync(residueRoot, { recursive: true, force: true })
  check('serial-max-in-flight-1', maxInFlight === 1, `maxInFlight=${maxInFlight}`)
  check('serial-sequence-matches-schedule', JSON.stringify(order) === JSON.stringify(sched.map((s) => s.seq)))
  check('serial-clean-run-no-failures', failures.length === 0 && executed.every((e) => e.status === 'ok'))
}
{
  const abort = { stopped: false, reason: null }
  const launched = []
  const { executed, failures } = await runSchedule(sched, async (step) => {
    launched.push(step.seq)
    if (step.seq === 3) throw new Error('boom at seq 3')
  }, abort)
  check('serial-first-failure-stops-rest', launched.length === 4 && failures.length === 1 && abort.stopped
    && executed.filter((e) => e.status === 'skipped').length === sched.length - 4
    && executed[3].status === 'failed', JSON.stringify({ launched, statuses: executed.map((e) => e.status) }))
}

console.log(failed ? `\nREGISTRY SELFTEST FAILED (${failed})` : '\nregistry selftest ✓ fake row covers verify→phase-gate end to end (no model call)')
process.exit(failed ? 1 : 0)
