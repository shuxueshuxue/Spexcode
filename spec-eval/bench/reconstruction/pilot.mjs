// spec-reconstruction-bench paid-pilot orchestration ([[spec-reconstruction-bench]]).
//
// PHASES ONLY CHANGE SCHEDULING. The frozen O0/R0/N0 arm definitions, knowledge budget, leak gates,
// future-task frame (episodes.json) and scoring口径 are unchanged from the dry-oracle — this module
// reuses run.ts's snapshot/gate machinery verbatim and adds: a no-model preflight (writes a gate
// summary to disk), a per-event model-verification gate, and the leaf/module/whole schedules.
//
//   preflight  — NO model call: frozen-file checks, snapshot gates + leak-positive twin, credential
//                file mode, endpoint TCP/TLS reachability (no message), negative egress probes, zero-
//                residue proof. Writes runs/pilot/preflight.json. Hard gates green → caller auto-continues.
//   verify-model — ONE minimal paid call through the sandbox; the observed model set must == {glm-5.2}.
//   phase leaf   — for each frozen leaf: R0 reconstruction, post-R0 leak/plant/secret gate, then the
//                  O0/R0/N0 executor arms on the SAME frozen future task (arms differ only in the
//                  injected neutral bundle; N0 = empty). Every run archived; secret-scanned.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, cpSync, readdirSync, renameSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { secretScan, rawByteScan, scanTreeRaw, readCredential, provenanceRecord, ENDPOINT_HOST, ENDPOINT_PORT, ENDPOINT_PATH, MODEL } from './sandbox.mjs'
import { executorRow, activeExecutorName } from './registry.mjs'
import { scoreSpecLint, scoreControls } from './scorer.mjs'
import { scoreMobileUi, scoreControlsMobile } from './browser-scorer.mjs'

const HERE = new URL('.', import.meta.url).pathname
const ROOT = join(HERE, '../../..')
const RUNS = join(HERE, 'runs')
const NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const nowIso = () => new Date().toISOString()

// ---- no-model preflight: every hard gate, NO paid call ----
export async function preflight({ credPath }) {
  const out = join(RUNS, 'pilot'); mkdirSync(out, { recursive: true })
  const gates = []
  const G = (name, ok, detail) => { gates.push({ name, ok, detail }); return ok }

  // 1. frozen files reproduce (delegates to run.ts select/episodes/tasks --check)
  let framesOk = true, frameDetail = ''
  for (const sub of ['select', 'episodes', 'tasks']) {
    try { execFileSync(`${NODE_DIST}/bin/node`, ['--import', 'tsx', join(HERE, 'run.ts'), sub, '--check'], { cwd: ROOT, stdio: 'pipe' }) }
    catch (e) { framesOk = false; frameDetail += `${sub} --check failed; ` }
  }
  G('frames-frozen', framesOk, frameDetail || 'select & episodes & tasks reproduce byte-identical')

  // 2. dry-oracle snapshot gates + leak-positive twin (run the runner; read its report)
  let dryOk = false, dryDetail = ''
  try {
    execFileSync(`${NODE_DIST}/bin/node`, ['--import', 'tsx', join(HERE, 'run.ts'), 'dry'], { cwd: ROOT, stdio: 'pipe', timeout: 120_000 })
    const rep = JSON.parse(readFileSync(join(RUNS, 'dry', 'dry-report.json'), 'utf8'))
    dryOk = true; dryDetail = `${rep.runs.length} builds + twin, all gates ✓ (exit 0)`
  } catch (e) { dryDetail = `dry exited non-zero or report missing: ${e.status ?? e.message}` }
  G('dry-oracle', dryOk, dryDetail)

  // 3. credential file: exists, 0600, key readable — value NEVER read into the report
  let credOk = false, credDetail = ''
  try {
    const st = statSync(credPath)
    const mode = (st.mode & 0o777).toString(8)
    const key = readCredential(credPath)
    credOk = mode === '600' && key.length >= 8
    credDetail = `mode=${mode} keyLen=${key.length} keySha256Prefix=${sha256(key).slice(0, 12)}`
  } catch (e) { credDetail = `unreadable: ${e.message}` }
  G('credential-file', credOk, credDetail)

  // 4. endpoint TCP/TLS reachability — NO message body, just a connect + TLS handshake probe
  let reachOk = false, reachDetail = ''
  try {
    const r = execFileSync('bash', ['-c',
      `curl -sS --max-time 15 -o /dev/null -w '%{http_code} %{ssl_verify_result}' https://${ENDPOINT_HOST}:${ENDPOINT_PORT}/api/anthropic/v1/models -H 'anthropic-version: 2023-06-01' -H 'x-api-key: NOPE' || true`],
      { encoding: 'utf8', timeout: 20_000 })
    const [code, ssl] = r.trim().split(' ')
    reachOk = ssl === '0' && /^[0-9]{3}$/.test(code)   // TLS verified; any HTTP status = endpoint alive
    reachDetail = `http=${code} tlsVerify=${ssl} (no message sent)`
  } catch (e) { reachDetail = `probe failed: ${e.message}` }
  G('endpoint-reachable', reachOk, reachDetail)

  // 5. negative egress + positive reachability through the sandbox bridge (NO model call — HTTP layer only)
  const netProbe = await sandboxNetProbe()
  G('egress-bridge-reaches', netProbe.bridgeReaches, `through-bridge /v1/models status=${netProbe.bridgeStatus} (any HTTP status = pipe reaches endpoint)`)
  G('egress-direct-blocked', netProbe.directBlocked, `direct IP: ${netProbe.directErr}`)
  G('egress-dns-blocked', netProbe.dnsBlocked, `foreign DNS: ${netProbe.dnsErr}`)
  G('zero-residue', netProbe.zeroResidue, `post-probe bridges=${netProbe.residueBridges} containers=${netProbe.residueContainers}`)

  // 6. secret-scan detection power self-test (must find a planted copy of the key)
  const key = readCredential(credPath)
  const planted = secretScan(`prefix ${key} suffix`, key)
  const cleanScan = secretScan('no secret here at all', key)
  G('secret-scan-power', planted.keyHits === 1 && cleanScan.keyHits === 0, `planted hit=${planted.keyHits} clean hit=${cleanScan.keyHits}`)

  const allOk = gates.every((g) => g.ok)
  // (3) pin the full provenance the phase will bind to: runner commit, docker image id, claude digest,
  // the frozen tasks/cards hashes, endpoint, model, config. The phase compares ALL of these to `now`.
  const prov = provenanceRecord()
  const tasksSha = sha256(readFileSync(join(HERE, 'tasks.json')))
  const cardsSha = sha256(readFileSync(join(HERE, 'task-cards.json')))
  const report = {
    v: 2, at: nowIso(), bench: 'spec-reconstruction-bench', phase: 'preflight',
    binding: {
      runnerCommit: prov.runnerCommit, runnerDirty: prov.runnerDirty,
      dockerImageId: prov.dockerImageId, claudePkgDigest: prov.claudePkgDigest, claudeVersion: prov.claudeVersion,
      tasksSha256: tasksSha, cardsSha256: cardsSha,
      endpointHost: ENDPOINT_HOST, model: MODEL, endpointPath: ENDPOINT_PATH,
    },
    historicalPreflightFailures: [
      { at: '2026-07-14', probe: 'bwrap/unshare userns isolation', outcome: 'blocked by kernel.apparmor_restrict_unprivileged_userns=1', resolution: 'switched to docker --network none + bridge; NOT counted in valid-run denominator' },
      { at: '2026-07-14', probe: 'global claude-glm wrapper read + gateway probe', outcome: 'protocol failure — wrong provider/credential path', resolution: 'discarded; experiment executor uses only the approved BigModel endpoint + per-run env-file; NOT a valid run' },
      { at: '2026-07-14', probe: 'BigModel account verify-model', outcome: '429 [1302] account rate limit', resolution: 'valid-infra/account-blocked; GLM held; Codex executor row approved as alternative' },
    ],
    gates, allOk,
  }
  writeFileSync(join(out, 'preflight.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

// HTTP-layer network probe through the real sandbox (docker --network none + bridge). NO model call.
async function sandboxNetProbe() {
  const scratch = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
  const sock = join(scratch, 'glm.sock')
  execFileSync('chmod', ['777', scratch])
  const name = 'srb-preflight-net'
  let bridge = null, res = ''
  const cleanup = () => {
    try { if (bridge) bridge.kill('SIGKILL') } catch {}
    try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }) } catch {}
    try { rmSync(scratch, { recursive: true, force: true }) } catch {}
  }
  try {
    bridge = spawn(`${NODE_DIST}/bin/node`, [join(HERE, 'bridge.mjs'), 'host', sock, ENDPOINT_HOST, String(ENDPOINT_PORT)], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 400))
    const inner = [
      `/opt/node/bin/node /assets/bridge.mjs ns /run/glm.sock 18443 2>/dev/null &`,
      'sleep 0.4',
      `echo BRIDGE $(/opt/node/bin/node -e 'fetch("https://${ENDPOINT_HOST}:18443/api/anthropic/v1/models",{headers:{"x-api-key":"NOPE","anthropic-version":"2023-06-01"},signal:AbortSignal.timeout(12000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log("ERR:"+(e.cause?.code||e.message));process.exit(0)})')`,
      `echo DIRECT $(/opt/node/bin/node -e 'fetch("https://223.5.5.5/",{signal:AbortSignal.timeout(5000)}).then(r=>{console.log("REACH:"+r.status)}).catch(e=>{console.log(e.cause?.code||e.message)}).finally(()=>process.exit(0))')`,
      `echo DNS $(/opt/node/bin/node -e 'fetch("https://example.com/",{signal:AbortSignal.timeout(5000)}).then(r=>{console.log("REACH:"+r.status)}).catch(e=>{console.log(e.cause?.code||e.message)}).finally(()=>process.exit(0))')`,
    ].join('\n')
    res = execFileSync('timeout', ['60', 'docker', 'run', '--rm', '--name', name,
      '--network', 'none', '--add-host', `${ENDPOINT_HOST}:127.0.0.1`,
      '-v', `${NODE_DIST}:/opt/node:ro`, '-v', `${join(HERE, 'bridge.mjs')}:/assets/bridge.mjs:ro`,
      '-v', `${sock}:/run/glm.sock`, 'scb-spexcode-base:0.4.0', 'bash', '-c', inner],
      { encoding: 'utf8', timeout: 90_000 })
  } finally {
    cleanup()
  }
  // residue proof AFTER cleanup — check the tracked bridge PID directly (pgrep self-matches its own
  // pattern, so it is unreliable here) and the container by name.
  await new Promise((r) => setTimeout(r, 300))
  let bridgeAlive = false
  try { if (bridge?.pid) { process.kill(bridge.pid, 0); bridgeAlive = true } } catch { bridgeAlive = false }
  const rc = parseInt(execFileSync('bash', ['-c', `docker ps -aq -f name=${name} | wc -l`], { encoding: 'utf8' }).trim(), 10)
  const g = (k) => (res.split('\n').find((l) => l.startsWith(k + ' ')) ?? '').slice(k.length + 1).trim()
  const bridgeStatus = g('BRIDGE'), directErr = g('DIRECT'), dnsErr = g('DNS')
  return {
    bridgeStatus, bridgeReaches: /^\d{3}$/.test(bridgeStatus),
    directErr, directBlocked: /ENETUNREACH|EAI_AGAIN|ECONNREFUSED|timeout|aborted/i.test(directErr),
    dnsErr, dnsBlocked: /EAI_AGAIN|ENOTFOUND|timeout|aborted/i.test(dnsErr),
    residueBridges: bridgeAlive ? 1 : 0, residueContainers: rc, zeroResidue: !bridgeAlive && rc === 0,
  }
}

// ---- minimal model-verification gate, THROUGH the registry row (never a direct harness call) ----
// Writes a NORMALIZED verify.json (unified contract fields + executor identity + provenance) that the
// phase's admittance gate reads — one shape for glm/codex/fake, so the gate never learns the harness.
export async function verifyModel({ credPath, executor = null, fakeKind = 'good', outDir = join(RUNS, 'pilot') }) {
  const row = executorRow(executor ?? activeExecutorName())
  const archiveDir = join(outDir, 'verify-model')
  const snap = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
  writeFileSync(join(snap, 'README.txt'), 'model verification probe workspace\n')
  try {
    const r = await row.launch({
      runId: 'verify-model', snapshotDir: snap,
      prompt: 'Reply with exactly the two characters: ok', writeSubdir: '.',
      credPath, timeoutMs: 5 * 60_000, archiveDir, upstreamCommit: null, fakeKind,
    })
    const verify = {
      at: nowIso(), executor: row.name, pin: row.pin,
      ok: r.ok, exitCode: r.exitCode, timedOut: r.timedOut, modelClean: r.modelClean,
      realCompletion: r.realCompletion, accountingValid: r.accountingValid, apiError: r.apiError,
      secretClean: r.secretClean, observedModels: r.trace?.model?.observedSet ?? null,
      provenance: r.trace?.provenance ?? null,
    }
    mkdirSync(archiveDir, { recursive: true })
    writeFileSync(join(archiveDir, 'verify.json'), JSON.stringify(verify, null, 2) + '\n')
    return { ...r, verify }
  } finally {
    try { rmSync(snap, { recursive: true, force: true }) } catch {}
  }
}

// the phase's verify-admittance predicate — PURE and harness-agnostic, exported so the no-model fake-row
// E2E can exercise the exact gate the paid phase uses. Binds executor identity + every hard gate +
// provenance (runner commit / immutable image id) when a `prov` to bind against is given.
export function verifyAdmitted(verify, { executor, prov = null } = {}) {
  const why = []
  if (!verify) return { ok: false, why: ['verify.json missing — run `pilot verify-model` first'] }
  if (verify.executor !== executor) why.push(`verify ran executor=${verify.executor}, batch pins ${executor} — no mixing`)
  for (const k of ['ok', 'modelClean', 'realCompletion', 'accountingValid', 'secretClean']) if (verify[k] !== true) why.push(`${k}=${verify[k]}`)
  if (verify.exitCode !== 0) why.push(`exitCode=${verify.exitCode}`)
  if (verify.timedOut) why.push('timedOut')
  if (verify.apiError) why.push(`apiError=${verify.apiError} (a 429/rate-limited verify is NOT admissible)`)
  if (prov) {
    if (verify.provenance?.runnerCommit !== prov.runnerCommit) why.push('provenance.runnerCommit disagrees with now')
    if (verify.provenance?.dockerImageId !== prov.dockerImageId) why.push('provenance.dockerImageId disagrees with now')
  }
  return { ok: why.length === 0, why }
}

// ---- helpers for the phase schedules ----
const TSX_NODE = process.execPath
function runTs(args) {
  return execFileSync(TSX_NODE, ['--import', 'tsx', join(HERE, 'run.ts'), ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })
}
const upstreamHead = () => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return null } }

// neutral-projection bundle (§5): strip frontmatter syntax/status/format signatures; keep path, title,
// one-line intent, ownership file list, and body prose. Same shape for O0 and R0 so no arm is
// format-identifiable. N0 = no bundle at all.
function neutralProjection(specMd, relDir) {
  const fmEnd = specMd.startsWith('---\n') ? specMd.indexOf('\n---\n', 4) : -1
  const fm = fmEnd >= 0 ? specMd.slice(4, fmEnd) : ''
  const body = (fmEnd >= 0 ? specMd.slice(fmEnd + 5) : specMd).trim()
  const grab = (k) => { const m = fm.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm')); return m ? m[1].replace(/^["']|["']$/g, '') : '' }
  const code = []
  let inCode = false
  for (const line of fm.split('\n')) {
    if (/^code:\s*$/.test(line)) { inCode = true; continue }
    if (inCode) { const m = line.match(/^\s+-\s+(.+?)\s*$/); if (m) { code.push(m[1].split('#')[0].trim()); continue } inCode = false }
  }
  return `area: ${relDir}\ntitle: ${grab('title')}\nintent: ${grab('desc')}\nowns: ${code.join(', ')}\n\n${body}\n`
}

// ---- real external acceptance scorer (host, outside sandbox). Behavioural, never regex-as-main. ----
// spec-lint: run the produced lint.ts against a synthetic git fixture and OBSERVE coverage behaviour
// (scorer.mjs). mobile-ui: its acceptance is an async DOM race → needs a real browser harness (YATU),
// NOT YET IMPLEMENTED, so that leaf is GATED OUT of the paid phase (declared blind) rather than scored
// by regex. A leaf with no implemented behavioural scorer never runs paid arms.
const SCORER_IMPLEMENTED = new Set(['spec-lint', 'mobile-ui'])
async function scoreArm(leafId, workspaceDir, card) {
  if (leafId === 'spec-lint') return scoreSpecLint(join(workspaceDir, 'spec-cli/src'))       // sandboxed lint fixture-run
  if (leafId === 'mobile-ui') return await scoreMobileUi(workspaceDir)                         // headless-chromium DOM race, no-network
  throw new Error(`no behavioural scorer implemented for leaf ${leafId}`)
}

// ---- batch abort (shared) — after the first hard failure, NO new launch; in-flight calls finish & archive ----
class BatchStop extends Error {}
function guardAbort(abort, label) { if (abort.stopped) throw new BatchStop(`${label}: batch already stopped — ${abort.reason}`) }
function stopBatch(abort, msg) { if (!abort.stopped) { abort.stopped = true; abort.reason = msg }; throw new BatchStop(msg) }

// every per-run hard gate; any failure stops the whole batch (no silent downgrade, no retry).
// HARNESS-AGNOSTIC: reads only the unified runner contract — the expected model comes from the run's
// own trace (the adapter pin), never from a provider constant baked in here.
function enforceRunGates(abort, label, r) {
  const expected = r.trace?.model?.expected ?? 'adapter-pin'
  if (r.quarantined) stopBatch(abort, `${label} QUARANTINED — credential material in archived bytes`)
  if (r.timedOut) stopBatch(abort, `${label} timed out (${r.durationMs ?? r.trace?.durationMs}ms) — archived, no retry`)
  if (!r.accountingValid) stopBatch(abort, `${label} accounting-invalid — usage integrity failed: ${JSON.stringify(r.trace?.accounting?.anomalies ?? r.trace?.parsed?.errors ?? null)}`)
  if (r.apiError) stopBatch(abort, `${label} upstream API error — ${r.apiError} — archived, NOT retried`)
  if (!r.modelClean) stopBatch(abort, `${label} real endpoint model ${JSON.stringify(r.trace?.model?.observedSet)} != {${expected}}`)
  if (!r.secretClean) stopBatch(abort, `${label} secret scan hit in archived bytes`)
  if (!r.realCompletion) stopBatch(abort, `${label} no real ${expected} completion (0 output tokens)`)
  if (r.exitCode !== 0) stopBatch(abort, `${label} exitCode=${r.exitCode}`)
  if (!existsSync(join(r.archiveDir, 'trace.json'))) stopBatch(abort, `${label} archive trace.json missing`)
}

// ---- scope analysis via pre/post diff INCLUDING deletions; archive allowed + violation exact paths ----
function walkRel(dir, base = dir, acc = []) {
  for (const e of readdirSyncSafe(dir)) {
    const abs = join(dir, e)
    const st = statSafe(abs)
    if (st?.isDirectory()) { if (e !== '.git') walkRel(abs, base, acc) }
    else if (st?.isFile()) acc.push(abs.slice(base.length + 1))
  }
  return acc
}
function scopeAnalysis(preSnapDir, workDir, governed) {
  const gov = new Set(governed)
  const post = workDir && existsSync(workDir) ? walkRel(workDir) : []
  const pre = existsSync(preSnapDir) ? walkRel(preSnapDir) : []
  const postSet = new Set(post)
  const changed = post.filter((rel) => { const a = readFileSafe(join(preSnapDir, rel)); const b = readFileSafe(join(workDir, rel)); return a === null || a !== b })
  const deleted = pre.filter((rel) => !postSet.has(rel))
  const violations = [
    ...changed.filter((r) => !gov.has(r)).map((r) => ({ path: r, kind: 'changed-outside-governed' })),
    ...deleted.filter((r) => !gov.has(r)).map((r) => ({ path: r, kind: 'deleted-outside-governed' })),
  ]
  return { allowedGoverned: governed, changedFiles: changed, deletedFiles: deleted, violations }
}

// ---- leaf phase (order-balanced blocks): recon is per UNIQUE leaf; arms run per BLOCK in the block's
// frozen rotation. A repeat block reuses its leaf's cached recon + bundles (recon spent once). ----
export async function reconLeaf(leaf, cards, c0, credPath, abort, stageDir, row) {
  const id = leaf.id
  // (H) guard on the FIRST line of the exported entry — a direct call (bypassing leafPhase enforcement)
  // must not spend money on a leaf with no real behavioural scorer.
  if (!SCORER_IMPLEMENTED.has(id)) throw new Error(`reconLeaf refused: leaf ${id} has no implemented behavioural scorer (gated blind) — no paid launch`)
  if (!abort || typeof abort !== 'object') throw new Error('reconLeaf refused: missing shared abort state — call via leafPhase')
  if (!stageDir) throw new Error('reconLeaf refused: missing stageDir — all phase output goes through the staging tree')
  if (!row?.launch) throw new Error('reconLeaf refused: missing executor row — every launch goes through the pinned registry row')
  const card = cards.leaves[leaf.relDir]
  if (!card) stopBatch(abort, `no task card for leaf ${leaf.relDir}`)
  const base = join(stageDir, 'leaf', id)
  mkdirSync(base, { recursive: true })
  const upstream = upstreamHead()
  // 1. R0 generation snapshot (C0, leaf-masked)
  const genDir = join(base, 'gen-snapshot')
  runTs(['snapshot', '--scale', 'leaf', '--target', leaf.relDir, '--out', genDir])
  const genManifest = JSON.parse(readFileSync(join(genDir, 'manifest.json'), 'utf8'))
  if (genManifest.leakage.violations.length || genManifest.canary.hits.length) stopBatch(abort, `${id} generation snapshot leakage/canary hits`)
  // 2. R0 reconstruction (isolated, through the pinned registry row)
  guardAbort(abort, `recon-${id}`)
  const recon = await row.launch({ runId: `recon-${id}`, snapshotDir: join(genDir, 'snapshot'), prompt: readFileSync(join(genDir, 'PROMPT.md'), 'utf8'),
    writeSubdir: '.', credPath, timeoutMs: 20 * 60_000, archiveDir: join(base, 'recon'), upstreamCommit: upstream })
  enforceRunGates(abort, `recon-${id}`, recon)
  // 3. R0 required-file + schema gate; empty/failed R0 is a HARD STOP, never a silent N0
  const reconPath = join(recon.workDir, '.spec-recon', leaf.relDir, 'spec.md')
  const reconMd = existsSync(reconPath) ? readFileSync(reconPath, 'utf8') : ''
  const hasFrontmatter = /^---\n[\s\S]*?\n---\n/.test(reconMd)
  const bodyChars = reconMd.replace(/^---\n[\s\S]*?\n---\n/, '').trim().length
  const reconValid = hasFrontmatter && bodyChars >= 200
  const o0Md = execFileSync('git', ['-C', ROOT, 'show', `${c0}:.spec/${leaf.relDir}/spec.md`], { encoding: 'utf8' })
  const o0Shingles = [...new Set(o0Md.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 40))]
  const overlap = o0Shingles.filter((s) => reconMd.replace(/\s+/g, ' ').includes(s))
  const plantIn = reconMd.includes('SRB-LEAK-CANARY')
  writeFileSync(join(base, 'recon', 'r0-audit.json'), JSON.stringify({ reconValid, hasFrontmatter, bodyChars, requiredFile: `.spec-recon/${leaf.relDir}/spec.md`, o0ShingleOverlap: overlap.length, overlapSample: overlap.slice(0, 5), plantDetected: plantIn }, null, 2) + '\n')
  if (plantIn) stopBatch(abort, `${id} R0 output contains the paired-canary plant`)
  if (overlap.length > 0) stopBatch(abort, `${id} R0 output has ${overlap.length} verbatim O0 shingle(s) — possible leak/memorisation`)
  if (!reconValid) stopBatch(abort, `${id} R0 invalid (frontmatter=${hasFrontmatter} bodyChars=${bodyChars}) — required .spec-recon file missing/thin; NOT downgraded to N0`)
  const bundles = { O0: neutralProjection(o0Md, leaf.relDir), R0: neutralProjection(reconMd, leaf.relDir), N0: null }
  return { leaf: id, relDir: leaf.relDir, card, upstream,
    recon: { valid: reconValid, bodyChars, o0Overlap: overlap.length, model: recon.trace.model.observedSet, sessionIds: recon.trace.sessionIds, tokens: recon.trace.tokens, durationMs: recon.trace.durationMs, archive: join(base, 'recon') },
    bundles }
}

// run ONE order-balanced block: the arms in block.armOrder against the frozen future task, using the
// leaf's cached recon bundles. Archived under leaf/<id>/block-<n>/arm-<arm> (disambiguates a repeat).
export async function runBlock(block, leaf, ctx, credPath, abort, stageDir, row) {
  if (!SCORER_IMPLEMENTED.has(block.leafId)) throw new Error(`runBlock refused: leaf ${block.leafId} has no behavioural scorer`)
  if (!abort || typeof abort !== 'object') throw new Error('runBlock refused: missing shared abort state')
  if (!stageDir) throw new Error('runBlock refused: missing stageDir — all phase output goes through the staging tree')
  if (!row?.launch) throw new Error('runBlock refused: missing executor row — every launch goes through the pinned registry row')
  const { card, bundles, upstream } = ctx
  const governed = card.governedFiles ?? (card.governedFile ? [card.governedFile] : [])
  const bdir = join(stageDir, 'leaf', block.leafId, `block-${block.block}`)
  mkdirSync(bdir, { recursive: true })
  const arms = {}
  for (const arm of block.armOrder) {
    guardAbort(abort, `${block.leafId}#${block.block}-${arm}`)
    const armBase = join(bdir, `arm-${arm}`)
    const execDir = join(armBase, 'exec-snapshot')
    const bundleText = bundles[arm]
    mkdirSync(armBase, { recursive: true })
    const bundleArgs = bundleText ? ['--bundle-rel', `${leaf.relDir}/BUNDLE.md`, '--bundle-file', join(armBase, 'bundle.md')] : []
    if (bundleText) writeFileSync(join(armBase, 'bundle.md'), bundleText)
    runTs(['exec-snapshot', '--commit', leaf.preState, '--governed', governed.join(','), '--out', execDir, ...bundleArgs])
    const execManifest = JSON.parse(readFileSync(join(execDir, 'exec-manifest.json'), 'utf8'))
    if (!execManifest.strippedAllSpec || !execManifest.governedPresent) stopBatch(abort, `${block.leafId}#${block.block}/${arm} exec snapshot invalid`)
    const run = await row.launch({ runId: `${block.leafId}-b${block.block}-${arm}`, snapshotDir: join(execDir, 'snapshot'), prompt: execPrompt(card.request),
      writeSubdir: '.', credPath, timeoutMs: 20 * 60_000, archiveDir: armBase, upstreamCommit: upstream })
    enforceRunGates(abort, `${block.leafId}#${block.block}-${arm}`, run)
    const scope = scopeAnalysis(join(execDir, 'snapshot'), run.workDir, governed)
    const score = await scoreArm(block.leafId, run.workDir, card)
    writeFileSync(join(armBase, 'score.json'), JSON.stringify({ block: block.block, arm, score, scope }, null, 2) + '\n')
    arms[arm] = { archive: armBase, trace: run.trace, scopeViolations: scope.violations.length, score: { scorer: score.scorer, passed: score.passed, total: score.total, checks: score.checks } }
  }
  return { block: block.block, leaf: block.leafId, relDir: leaf.relDir, episode: leaf.episode.sha, preState: leaf.preState, armOrder: block.armOrder, repeat: block.repeat, arms }
}

function execPrompt(request) {
  return `# Implementation task

You are working in a snapshot of a TypeScript/React monorepo (a spec-driven dev tool). The snapshot has
no git history and no network access. Make the change described below to the existing source files.

If a directory \`.spec-context/\` is present at the snapshot root, it holds design-intent notes for the
area you are changing — read them first and let them guide the change. If it is absent, work from the
code alone. Edit the relevant source files in place; do not create unrelated new modules.

## Request

${request}
`
}

const readdirSyncSafe = (d) => { try { return readdirSync(d, { withFileTypes: true }).map((e) => e.name) } catch { return [] } }
const statSafe = (p) => { try { return statSync(p) } catch { return null } }
const readFileSafe = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

export async function leafPhase({ credPath, executor = null }) {
  const tasks = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'))
  const cards = JSON.parse(readFileSync(join(HERE, 'task-cards.json'), 'utf8'))
  const abort = { stopped: false, reason: null }
  // ONE executor row for the WHOLE batch — pinned before anything launches; recon and every arm go
  // through this row and only this row (no mixing, no direct harness calls).
  const row = executorRow(executor ?? activeExecutorName())
  // EVERY byte this phase produces goes into a staging tree first; nothing is published in place.
  // At the end the staging tree is fail-closed raw-scanned and promoted by ONE atomic rename (or
  // quarantined). Pre-existing STAGE or FINAL is NEVER removed — both fail loud and stay for inspection.
  const STAGE = join(RUNS, 'pilot', 'phase-leaf.STAGING')
  const FINAL = join(RUNS, 'pilot', 'phase-leaf')
  if (existsSync(FINAL)) throw new Error(`FATAL: ${FINAL} already exists — a published archive is never overwritten; archive/move it first`)
  if (existsSync(STAGE)) throw new Error(`FATAL: ${STAGE} already exists (a prior phase crashed mid-stage?) — inspect and move it first; staging is never clobbered`)
  mkdirSync(STAGE, { recursive: true })

  // (6) phase enforcement — bind to the exact frozen inputs + committed runner/image + the prior-stage
  // traces, not operator memory. (A) preflight.json, check.json and the verify-model trace must ALL exist,
  // pass, and agree on the SAME runnerCommit/imageID/claudeDigest/endpoint/model.
  const enforce = []
  const E = (name, ok, detail) => { enforce.push({ name, ok, detail }); if (!ok) stopBatch(abort, `phase-enforcement ${name}: ${detail}`) }
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
  const prov = provenanceRecord()
  try { runTs(['tasks', '--check']); E('tasks-frozen', true, 'tasks --check rc0') } catch (e) { E('tasks-frozen', false, 'tasks --check non-zero') }
  const cardsSha = sha256(readFileSync(join(HERE, 'task-cards.json')))
  E('cards-hash', cardsSha === tasks.cardsSha256, `cards sha ${cardsSha.slice(0, 12)} vs pinned ${String(tasks.cardsSha256).slice(0, 12)}`)
  E('runner-committed', prov.runnerDirty === false, `runner working tree dirty=${prov.runnerDirty} — commit before paid runs`)
  E('docker-image-pinned', !!prov.dockerImageId, `image ${prov.dockerImage} id=${String(prov.dockerImageId).slice(0, 16)}`)
  // the BATCH executor's own provenance must be fully pinned (harness identity fields non-null)
  const rowProv = row.provenance()
  E('executor-pinned', Object.values(rowProv).every((v) => v !== null && v !== undefined), `executor=${row.name} pin=${JSON.stringify(row.pin)} provenance keys=${Object.keys(rowProv).join(',')}`)
  // (A) prior stages present + agree on the FULL binding (runner/image/claude/tasksSha/cardsSha/endpoint/model)
  const preflight = readJson(join(RUNS, 'pilot', 'preflight.json'))
  const check = readJson(join(RUNS, 'pilot', 'check.json'))
  const tasksSha = sha256(readFileSync(join(HERE, 'tasks.json')))
  const bindingAgrees = (b) => !!b && b.runnerCommit === prov.runnerCommit && b.dockerImageId === prov.dockerImageId
    && b.claudePkgDigest === prov.claudePkgDigest && b.tasksSha256 === tasksSha && b.cardsSha256 === cardsSha
    && b.endpointHost === ENDPOINT_HOST && b.model === MODEL
  E('preflight-green', !!preflight && preflight.allOk === true, preflight ? `preflight allOk=${preflight.allOk}` : 'preflight.json missing — run `pilot preflight`')
  E('preflight-binding-agrees', bindingAgrees(preflight?.binding), 'preflight.json binding (runner/image/claude/tasksSha/cardsSha/endpoint/model) disagrees with now')
  E('check-green', !!check && check.checks?.every((c) => c.ok), check ? 'pilot check on record' : 'check.json missing — run `pilot check`')
  E('check-provenance-agrees', !!check && check.provenance?.runnerCommit === prov.runnerCommit && check.provenance?.dockerImageId === prov.dockerImageId && check.provenance?.claudePkgDigest === prov.claudePkgDigest, 'pilot check ran on a different runner/image/claude than now')
  // (A) the NORMALIZED verify.json must exist, PASS every hard gate, be from THIS batch's pinned
  // executor, and bind to the same runner commit / immutable image — via the same pure predicate the
  // no-model fake-row E2E exercises (verifyAdmitted).
  const verify = readJson(join(RUNS, 'pilot', 'verify-model', 'verify.json'))
  const vAdmit = verifyAdmitted(verify, { executor: row.name, prov })
  E('verify-model-admitted', vAdmit.ok, vAdmit.ok ? `executor=${verify.executor} all hard gates + provenance bound` : vAdmit.why.join('; '))
  // scorer controls must discriminate BEFORE paid runs (positive pass, negative rejected) — both leaves
  const specLintLeaf = tasks.leaves.find((l) => l.id === 'spec-lint')
  const mobileLeaf = tasks.leaves.find((l) => l.id === 'mobile-ui')
  if (specLintLeaf) {
    const ctl = scoreControls(ROOT, specLintLeaf.episode.sha, specLintLeaf.preState)
    writeFileSync(join(STAGE, 'scorer-controls-spec-lint.json'), JSON.stringify({ at: nowIso(), ...ctl }, null, 2) + '\n')
    E('scorer-controls-spec-lint', ctl.discriminates, `positive ${ctl.positive.passed}/${ctl.positive.total}, negative ${ctl.negative.passed}/${ctl.negative.total}`)
    // (5) the phase's control provenance (image id + every mount digest) must EQUAL what pilot check
    // recorded — the scorer scoring paid arms is byte-identically the scorer that passed its controls.
    E('control-provenance-spec-lint-bound', !!check?.controlProvenance?.specLint && JSON.stringify(ctl.provenance) === JSON.stringify(check.controlProvenance.specLint),
      check?.controlProvenance?.specLint ? `now=${JSON.stringify(ctl.provenance)} check=${JSON.stringify(check.controlProvenance.specLint)}` : 'check.json has no controlProvenance.specLint — re-run `pilot check`')
  }
  if (mobileLeaf) {
    const ctl = await scoreControlsMobile(ROOT, mobileLeaf.episode.sha, mobileLeaf.preState)
    writeFileSync(join(STAGE, 'scorer-controls-mobile.json'), JSON.stringify({ at: nowIso(), ...ctl }, null, 2) + '\n')
    E('scorer-controls-mobile', ctl.discriminates, `positive ${ctl.positive.passed}/${ctl.positive.total}, unchanged ${ctl.negatives?.unchanged.passed}/${ctl.negatives?.unchanged.total}, never-updates ${ctl.negatives?.neverUpdates.passed}/${ctl.negatives?.neverUpdates.total}`)
    E('control-provenance-mobile-bound', !!check?.controlProvenance?.mobile && JSON.stringify(ctl.provenance) === JSON.stringify(check.controlProvenance.mobile),
      check?.controlProvenance?.mobile ? `now=${JSON.stringify(ctl.provenance)} check=${JSON.stringify(check.controlProvenance.mobile)}` : 'check.json has no controlProvenance.mobile — re-run `pilot check`')
  }

  // gate: only leaves whose behavioural scorer is implemented run paid arms; others are declared blind
  const runnable = tasks.leaves.filter((l) => SCORER_IMPLEMENTED.has(l.id))
  const gatedOut = tasks.leaves.filter((l) => !SCORER_IMPLEMENTED.has(l.id)).map((l) => ({ leaf: l.id, reason: cards.leaves[l.relDir]?.acceptance?.status ?? 'no behavioural scorer implemented — declared blind spot' }))
  // (E) both leaves must be runnable — a single leaf with a fixed arm order is not a progressive comparison
  E('both-leaves-runnable', runnable.length === tasks.leaves.length && tasks.leaves.length >= 2, `${runnable.length}/${tasks.leaves.length} leaves runnable — the phase promises a two-leaf progressive comparison`)
  const blocks = tasks.blocks ?? []
  E('order-balanced-blocks', blocks.length === 3, `${blocks.length} frozen blocks (need 3 for a Latin-square order-balanced pilot)`)

  // recon is spent ONCE per unique leaf; blocks (incl the repeat) reuse the cached recon/bundles.
  const reconCtx = {}, results = [], failures = []
  const uniqueLeafIds = [...new Set(blocks.map((b) => b.leafId))]
  const reconSettled = await Promise.allSettled(uniqueLeafIds.map((lid) => reconLeaf(tasks.leaves.find((l) => l.id === lid), cards, tasks.c0, credPath, abort, STAGE, row)))
  reconSettled.forEach((s, i) => { if (s.status === 'fulfilled') reconCtx[uniqueLeafIds[i]] = s.value; else failures.push({ stage: 'recon', leaf: uniqueLeafIds[i], error: String(s.reason?.message ?? s.reason) }) })
  // run the 3 order-balanced blocks concurrently; shared abort halts new launches after any hard failure
  const blockSettled = await Promise.allSettled(blocks.map((b) => {
    const leaf = tasks.leaves.find((l) => l.id === b.leafId)
    const ctx = reconCtx[b.leafId]
    if (!ctx) return Promise.reject(new Error(`block ${b.block}: recon for ${b.leafId} unavailable (recon failed/aborted)`))
    return runBlock(b, leaf, ctx, credPath, abort, STAGE, row)
  }))
  blockSettled.forEach((s, i) => s.status === 'fulfilled' ? results.push(s.value) : failures.push({ stage: 'block', block: blocks[i].block, leaf: blocks[i].leafId, error: String(s.reason?.message ?? s.reason) }))
  const recon = Object.fromEntries(Object.entries(reconCtx).map(([k, v]) => [k, v.recon]))
  // final gate: report first, then a fail-closed raw scan with the STAGING TREE ITSELF as the scan root —
  // relative paths (and so pathSetDigest/contentDigest) are IDENTICAL before and after the promote rename,
  // so the recorded digests truthfully describe the PUBLISHED tree. The scan verdict is itself published
  // bytes, so scan→embed→RE-SCAN until stable across counts + scannedFiles + path-set digest — the LAST
  // act before the rename is always a full-byte scan with ZERO writes after it; no fixpoint in 3 passes =
  // unpublishable. The report embeds only the stable shape (count/path-set/secret summary); the full
  // CONTENT digest goes to the promotion ledger OUTSIDE the tree (a tree cannot embed its own digest),
  // written WRITE-AHEAD: prepare entry → atomic rename → committed entry — any ledger append failure is a
  // hard stop, and at every step FINAL/STAGE are intact and recoverable. Rename targets are never
  // pre-cleared: existing target = fail-loud; both renames are verified after the fact.
  const report = { v: 8, at: nowIso(), phase: 'leaf', executor: row.name, pin: row.pin, c0: tasks.c0, cEval: tasks.cEval, orderBalanced: true, significanceClaim: false, provenance: prov, enforcement: enforce, gatedOut, aborted: abort.stopped, abortReason: abort.reason, recon, blocks: results, failures }
  writeFileSync(join(STAGE, 'leaf-report.json'), JSON.stringify(report, null, 2) + '\n')
  let key = null; try { key = readCredential(credPath) } catch {}
  const summarize = (s) => ({ scannedFiles: s.scannedFiles, pathSetDigest: s.pathSetDigest, keyHits: s.keyHits, prefixHits: s.prefixHits, b64Hits: s.b64Hits, scanError: s.scanError, errors: s.errors, clean: s.clean })
  let scan = key ? scanTreeRaw(STAGE, key) : { scannedFiles: 0, pathSetDigest: null, contentDigest: null, keyHits: null, prefixHits: null, b64Hits: null, scanError: true, errors: ['credential unreadable — cannot certify archive'], clean: false }
  let stable = false
  for (let pass = 1; key && pass <= 3 && !stable; pass++) {
    report.finalArchiveScan = { scanRoot: 'phase-leaf', ...summarize(scan) }   // normalized to the FINAL name — relative content identical pre/post rename
    writeFileSync(join(STAGE, 'final-scan.json'), JSON.stringify({ at: nowIso(), pass, scanRoot: 'phase-leaf', ...summarize(scan) }, null, 2) + '\n')
    writeFileSync(join(STAGE, 'leaf-report.json'), JSON.stringify(report, null, 2) + '\n')
    const re = scanTreeRaw(STAGE, key)
    stable = ['clean', 'scanError', 'keyHits', 'prefixHits', 'b64Hits', 'scannedFiles', 'pathSetDigest'].every((k) => re[k] === scan[k])
    scan = re
  }
  if (!report.finalArchiveScan) report.finalArchiveScan = { scanRoot: 'phase-leaf', ...summarize(scan) }
  const publishable = stable && scan.clean
  const ledgerPath = join(RUNS, 'promotion-ledger.ndjson')
  const ledgerAppend = (entry) => {
    try { appendFileSync(ledgerPath, JSON.stringify(entry) + '\n') }
    catch (e) { throw new Error(`FATAL: promotion-ledger append failed (${e.message}) at action=${entry.action} — hard stop; STAGE/FINAL are intact on disk and recoverable`) }
  }
  if (publishable) {
    if (existsSync(FINAL)) throw new Error(`FATAL: ${FINAL} appeared during the phase — refusing to overwrite; do not publish`)
    ledgerAppend({ at: nowIso(), phase: 'leaf', action: 'prepare-promote', from: STAGE, to: FINAL, executor: row.name, scannedFiles: scan.scannedFiles, pathSetDigest: scan.pathSetDigest, contentDigest: scan.contentDigest })
    renameSync(STAGE, FINAL)                       // atomic promote: same parent, one rename, no pre-clear
    if (existsSync(STAGE) || !existsSync(FINAL)) throw new Error(`FATAL: promote rename ${STAGE} → ${FINAL} did not take effect`)
    ledgerAppend({ at: nowIso(), phase: 'leaf', action: 'commit-promote', to: FINAL, contentDigest: scan.contentDigest })
    report.publishedTo = FINAL
  } else {
    const q = join(RUNS, 'pilot', `phase-leaf.QUARANTINE-${Date.now()}`)
    if (existsSync(q)) throw new Error(`FATAL: quarantine target ${q} already exists — resolve manually; do not publish`)
    ledgerAppend({ at: nowIso(), phase: 'leaf', action: 'prepare-quarantine', from: STAGE, to: q, stable, scan: summarize(scan), contentDigest: scan.contentDigest })
    renameSync(STAGE, q)
    if (existsSync(STAGE) || !existsSync(q)) throw new Error(`FATAL: quarantine rename → ${q} did not take effect — do not publish`)
    ledgerAppend({ at: nowIso(), phase: 'leaf', action: 'commit-quarantine', to: q })
    report.quarantined = q
  }
  return report
}

// ---- CLI ----
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const CRED_DEFAULT = '/tmp/spec-reconstruction-zhipu-17557c6a.env'
const sub = argv[0] === 'pilot' ? argv[1] : argv[0]   // reachable via `run.ts pilot <sub>` or directly
if (sub === 'preflight') {
  const report = await preflight({ credPath: opt('--cred', CRED_DEFAULT) })
  console.log(`\npreflight ${report.allOk ? 'ALL GREEN ✓' : 'FAILED ✗'} — ${report.gates.filter((g) => g.ok).length}/${report.gates.length} gates`)
  for (const g of report.gates) console.log(`  ${g.ok ? '✓' : '✗'} ${g.name} — ${g.detail}`)
  console.log(`report: spec-eval/bench/reconstruction/runs/pilot/preflight.json`)
  process.exit(report.allOk ? 0 : 1)
} else if (sub === 'verify-model') {
  // --executor <glm|codex|fake>; default = the decision ledger's activeProvider (never a guess)
  const r = await verifyModel({ credPath: opt('--cred', CRED_DEFAULT), executor: opt('--executor', null) })
  console.log(`verify-model[${r.verify.executor}]: ok=${r.ok} exit=${r.exitCode} timedOut=${r.timedOut} modelClean=${r.modelClean} realCompletion=${r.realCompletion} secretClean=${r.secretClean}`)
  console.log(`  observed model set: ${JSON.stringify(r.verify.observedModels)} (pin ${JSON.stringify(r.verify.pin)})`)
  if (r.apiError) console.log(`  API error: ${r.apiError}`)
  console.log(`  usage: ${JSON.stringify(r.usage)} duration=${r.durationMs}ms`)
  console.log(`  archive: ${r.archiveDir} (normalized verify.json alongside)`)
  process.exit(r.ok ? 0 : 1)
} else if (sub === 'phase') {
  const scale = opt('--scale', 'leaf')
  if (scale !== 'leaf') { console.error(`only --scale leaf implemented in this stage (got ${scale})`); process.exit(2) }
  const report = await leafPhase({ credPath: opt('--cred', CRED_DEFAULT), executor: opt('--executor', null) })
  console.log(`\nleaf phase: ${report.blocks.length} blocks complete, ${report.failures.length} failed, ${report.gatedOut.length} gated-out, aborted=${report.aborted} (order-balanced pilot, no significance claim)`)
  for (const g of report.gatedOut) console.log(`  GATED [${g.leaf}]: ${g.reason}`)
  for (const [lid, rc] of Object.entries(report.recon ?? {})) console.log(`  recon[${lid}] valid=${rc.valid} bodyChars=${rc.bodyChars} o0Overlap=${rc.o0Overlap} model=${JSON.stringify(rc.model)} sessions=${rc.sessionIds?.length}`)
  for (const b of report.blocks) {
    console.log(`  block ${b.block} [${b.leaf}${b.repeat ? ' REPEAT' : ''}] armOrder=${JSON.stringify(b.armOrder)}`)
    for (const a of b.armOrder) console.log(`    ${a}: model=${JSON.stringify(b.arms[a].trace.model.observedSet)} score=${b.arms[a].score.passed}/${b.arms[a].score.total} scope-viol=${b.arms[a].scopeViolations} in/out=${b.arms[a].trace.tokens.input}/${b.arms[a].trace.tokens.output}`)
  }
  for (const f of report.failures) console.log(`  STOP [${f.stage ?? ''} ${f.leaf ?? ''}${f.block != null ? '#' + f.block : ''}]: ${f.error}`)
  console.log(report.publishedTo ? `  published (atomic promote): ${report.publishedTo}` : `  NOT published — quarantined: ${report.quarantined ?? 'n/a'} (finalArchiveScan=${JSON.stringify(report.finalArchiveScan)})`)
  process.exit(report.failures.length || report.aborted || !report.publishedTo ? 1 : 0)
} else if (sub === 'check') {
  // NO-MODEL regression + control suite — must pass rc0 BEFORE any paid run. Runs every gate that
  // needs no paid call: usage aggregation regression, scorer positive/negative controls, frozen frames,
  // dry-oracle, cards-hash binding, provenance pinning (image/claude). Runner-dirty is reported, not failed.
  const checks = []
  const K = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`) }
  const tryRun = (label, fn) => { try { return fn() } catch (e) { return { __err: String(e.status ?? e.message ?? e) } } }
  const usage = tryRun('usage', () => execFileSync(TSX_NODE, [join(HERE, 'usage.selftest.mjs')], { cwd: ROOT, encoding: 'utf8' }))
  K('usage-aggregation-regression', !usage.__err, usage.__err ? `FAILED ${usage.__err}` : 'no double-count, monotonic fail-loud, missing-field keeps prior')
  const tasks = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'))
  const specLintLeaf = tasks.leaves.find((l) => l.id === 'spec-lint')
  const ctl = specLintLeaf ? tryRun('ctl', () => scoreControls(ROOT, specLintLeaf.episode.sha, specLintLeaf.preState)) : { discriminates: false }
  K('scorer-controls-spec-lint', !!ctl.discriminates, ctl.discriminates ? `positive ${ctl.positive.passed}/${ctl.positive.total}, negative ${ctl.negative.passed}/${ctl.negative.total} (pre-state rejected, sandboxed)` : `FAILED ${ctl.__err ?? 'no discrimination'}`)
  const mobileLeaf = tasks.leaves.find((l) => l.id === 'mobile-ui')
  let mctl = { discriminates: false }
  if (mobileLeaf) { try { mctl = await scoreControlsMobile(ROOT, mobileLeaf.episode.sha, mobileLeaf.preState) } catch (e) { mctl = { __err: String(e.message ?? e) } } }
  K('scorer-controls-mobile', !!mctl.discriminates, mctl.discriminates ? `positive ${mctl.positive.passed}/${mctl.positive.total}, unchanged ${mctl.negatives.unchanged.passed}/${mctl.negatives.unchanged.total}, never-updates ${mctl.negatives.neverUpdates.passed}/${mctl.negatives.neverUpdates.total} (browser/DOM, both negatives rejected)` : `FAILED ${mctl.__err ?? 'no discrimination'}`)
  // registry fake-row E2E: the verify→phase-gate wiring, no model, through the SAME registry/gate code
  const regE2e = tryRun('registry', () => execFileSync(TSX_NODE, [join(HERE, 'registry.selftest.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 }))
  K('registry-fake-e2e', !regE2e.__err, regE2e.__err ? `FAILED ${regE2e.__err}` : 'fake row: unified contract + verify.json → verifyAdmitted gate (accept/reject/mix-refusal)')
  // codex auth-binding YATU: real CLI in network-none, loopback fake provider, dummy env_key credential
  const authProbe = tryRun('auth', () => execFileSync(TSX_NODE, [join(HERE, 'auth-probe.mjs')], { cwd: ROOT, encoding: 'utf8', timeout: 200_000 }))
  K('codex-auth-binding', !authProbe.__err, authProbe.__err ? `FAILED ${authProbe.__err}` : 'CLI sent Bearer <dummy env_key> to loopback pinned provider, body model=gpt-5.5, /v1/responses')
  for (const c of ['select', 'episodes', 'tasks']) { const r = tryRun(c, () => runTs([c, '--check'])); K(`frame-${c}`, !r.__err, r.__err ? `FAILED ${r.__err}` : 'byte-identical') }
  const dry = tryRun('dry', () => runTs(['dry'])); K('dry-oracle', !dry.__err, dry.__err ? `FAILED ${dry.__err}` : 'all gates + twin')
  const cardsSha = sha256(readFileSync(join(HERE, 'task-cards.json')))
  K('cards-hash-binding', cardsSha === tasks.cardsSha256, `cards ${cardsSha.slice(0, 12)} vs pinned ${String(tasks.cardsSha256).slice(0, 12)}`)
  const prov = provenanceRecord()
  K('provenance-pinned', !!prov.dockerImageId && !!prov.claudeVersion && !!prov.claudePkgDigest, `image=${String(prov.dockerImageId).slice(0, 19)} claude=${prov.claudeVersion} digest=${prov.claudePkgDigest} runnerDirty=${prov.runnerDirty} (dirty is informational here; the paid phase HARD-gates on committed)`)
  mkdirSync(join(RUNS, 'pilot'), { recursive: true })
  // (5) the CONTROL PROVENANCE (image id + every mount digest) is recorded, not discarded — the paid
  // phase re-runs its controls and hard-binds their provenance to these very values.
  writeFileSync(join(RUNS, 'pilot', 'check.json'), JSON.stringify({
    at: nowIso(), checks, provenance: prov,
    controlProvenance: { specLint: ctl.provenance ?? null, mobile: mctl.provenance ?? null },
  }, null, 2) + '\n')
  const hardOk = checks.filter((c) => c.name !== 'provenance-pinned' || c.ok).every((c) => c.ok)
  console.log(hardOk ? '\npilot check ✓ all no-model regressions + controls pass' : '\npilot check ✗ FAILED')
  process.exit(hardOk ? 0 : 1)
} else if (sub) {
  console.error(`unknown pilot subcommand: ${sub} (check | preflight | verify-model [--executor glm|codex|fake] | phase --scale leaf [--executor …])`)
  process.exit(2)
}
