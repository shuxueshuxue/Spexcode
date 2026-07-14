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
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, cpSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { launchAgent, secretScan, readCredential, ENDPOINT_HOST, ENDPOINT_PORT, MODEL } from './sandbox.mjs'

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

  // 1. frozen files reproduce (delegates to run.ts select/episodes --check)
  let framesOk = true, frameDetail = ''
  for (const sub of ['select', 'episodes']) {
    try { execFileSync(`${NODE_DIST}/bin/node`, ['--import', 'tsx', join(HERE, 'run.ts'), sub, '--check'], { cwd: ROOT, stdio: 'pipe' }) }
    catch (e) { framesOk = false; frameDetail += `${sub} --check failed; ` }
  }
  G('frames-frozen', framesOk, frameDetail || 'select & episodes reproduce byte-identical')

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
  const report = {
    v: 1, at: nowIso(), bench: 'spec-reconstruction-bench', phase: 'preflight', model: MODEL,
    endpointHost: ENDPOINT_HOST,
    historicalPreflightFailures: [
      { at: '2026-07-14', probe: 'bwrap/unshare userns isolation', outcome: 'blocked by kernel.apparmor_restrict_unprivileged_userns=1', resolution: 'switched to docker --network none + bridge; NOT counted in valid-run denominator' },
      { at: '2026-07-14', probe: 'global claude-glm wrapper read + gateway probe', outcome: 'protocol failure — wrong provider/credential path', resolution: 'discarded; experiment executor uses only the approved BigModel endpoint + per-run env-file; NOT a valid run' },
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

// ---- minimal paid model-verification gate ----
export async function verifyModel({ credPath }) {
  const archiveDir = join(RUNS, 'pilot', 'verify-model')
  const snap = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim()
  writeFileSync(join(snap, 'README.txt'), 'model verification probe workspace\n')
  try {
    return await launchAgent({
      runId: 'verify-model', snapshotDir: snap,
      prompt: 'Reply with exactly the two characters: ok', writeSubdir: '.',
      credPath, timeoutMs: 5 * 60_000, archiveDir, upstreamCommit: null,
    })
  } finally {
    try { rmSync(snap, { recursive: true, force: true }) } catch {}
  }
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

// external acceptance scorer (runs on the HOST, outside the sandbox, over the archived workspace).
// Structural for the pilot (honestly labelled); raw per-assertion output archived. Never a win/loss verdict.
function scoreLeaf(leafId, workspaceDir, card) {
  const read = (rel) => { try { return readFileSync(join(workspaceDir, rel), 'utf8') } catch { return '' } }
  const checks = []
  const C = (name, ok, evidence) => checks.push({ name, ok, evidence: evidence.slice(0, 200) })
  if (leafId === 'spec-lint') {
    const src = read('spec-cli/src/lint.ts')
    C('related-counts-coverage', /related/.test(src) && /(claimed|covered|owners)\b/.test(src) && /related/.test(src.split('coverage')[0] ?? src) || /for\s*\(.*related/.test(src), src.match(/.*related.*/)?.[0] ?? 'no related mention')
    C('related-integrity', /related/.test(src) && /integrity/.test(src) && /missing/i.test(src), src.match(/.*related.*missing.*/i)?.[0] ?? 'no related integrity check')
    C('hub-summary-single', /(hub|>=\s*2|governed by (two|>=2|2\+))/i.test(src) && /length/.test(src), src.match(/.*hub.*/i)?.[0] ?? 'no hub summary')
    C('nonempty-change', src.length > 0, `lint.ts ${src.length} chars`)
  } else if (leafId === 'mobile-ui') {
    const app = read('spec-dashboard/src/App.jsx'); const css = read('spec-dashboard/src/styles.css')
    C('eval-pane-handler', /setPane\(['"]eval['"]\)/.test(app) || /'eval'/.test(app) && /overlay|Overlay/.test(app), app.match(/.*eval.*/)?.[0] ?? 'no eval-pane handler')
    C('handler-wired-to-panel', /onOpen\w*=\{/.test(app) || /FocusPanel[^>]*on\w+=/.test(app), app.match(/FocusPanel[^>]*/)?.[0] ?? 'no panel prop wiring')
    C('scenario-row-button', /\.fp-scenario\s*\{[^}]*(border:\s*none|background:\s*none|cursor:\s*pointer)/s.test(css), (css.match(/\.fp-scenario\s*\{[^}]*\}/s)?.[0] ?? 'no .fp-scenario').slice(0, 200))
    C('expected-clamp', /line-clamp|-webkit-line-clamp/.test(css), css.match(/.*line-clamp.*/)?.[0] ?? 'no clamp')
  }
  return { leafId, scorer: card.acceptance.scorer, checks, passed: checks.filter((c) => c.ok).length, total: checks.length }
}

// hard fail-loud: any leak / model!=glm-5.2 / secret hit / archive-manifest failure aborts the WHOLE batch.
function enforceRunGates(label, r) {
  if (r.timedOut) throw new Error(`BATCH-STOP: ${label} timed out (${r.trace?.durationMs}ms) — archived as failure, no silent retry`)
  if (!r.modelClean) throw new Error(`BATCH-STOP: ${label} observed model set ${JSON.stringify(r.trace?.model?.observedSet)} != {${MODEL}}`)
  if (!r.secretClean) throw new Error(`BATCH-STOP: ${label} secret scan found credential material in archived bytes`)
  if (!existsSync(join(r.archiveDir, 'trace.json'))) throw new Error(`BATCH-STOP: ${label} archive manifest (trace.json) missing`)
}

// ---- leaf phase: R0 recon + O0/R0/N0 executor arms per leaf (arms share ONE frozen future task) ----
export async function runLeaf(leaf, cards, c0, credPath) {
  const id = leaf.id
  const card = cards.leaves[leaf.relDir]
  if (!card) throw new Error(`no task card for leaf ${leaf.relDir}`)
  const base = join(RUNS, 'pilot', 'leaf', id)
  mkdirSync(base, { recursive: true })
  const upstream = upstreamHead()

  // 1. R0 generation snapshot (C0, leaf-masked) — reuse run.ts snapshot machinery (subprocess)
  const genDir = join(base, 'gen-snapshot')
  runTs(['snapshot', '--scale', 'leaf', '--target', leaf.relDir, '--out', genDir])
  const genManifest = JSON.parse(readFileSync(join(genDir, 'manifest.json'), 'utf8'))
  if (genManifest.leakage.violations.length || genManifest.canary.hits.length) throw new Error(`BATCH-STOP: ${id} generation snapshot has leakage/canary hits`)
  const genPrompt = readFileSync(join(genDir, 'PROMPT.md'), 'utf8')

  // 2. R0 reconstruction (isolated, GLM-5.2)
  const recon = await launchAgent({ runId: `recon-${id}`, snapshotDir: join(genDir, 'snapshot'), prompt: genPrompt,
    writeSubdir: '.', credPath, timeoutMs: 20 * 60_000, archiveDir: join(base, 'recon'), upstreamCommit: upstream })
  enforceRunGates(`recon-${id}`, recon)

  // 3. post-R0 leak/plant audit: masked O0 shingles must not appear verbatim in R0 output
  const o0Md = execFileSync('git', ['-C', ROOT, 'show', `${c0}:.spec/${leaf.relDir}/spec.md`], { encoding: 'utf8' })
  const reconPath = join(recon.workDir ?? join(base, 'recon', 'workspace'), '.spec-recon', leaf.relDir, 'spec.md')
  const reconMd = existsSync(reconPath) ? readFileSync(reconPath, 'utf8') : ''
  const o0Shingles = [...new Set(o0Md.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 40))]
  const overlap = o0Shingles.filter((s) => reconMd.replace(/\s+/g, ' ').includes(s))
  const plantIn = reconMd.includes('SRB-LEAK-CANARY')
  if (plantIn) throw new Error(`BATCH-STOP: ${id} R0 output contains the paired-canary plant`)
  const reconValid = reconMd.trim().length > 0
  writeFileSync(join(base, 'recon', 'r0-audit.json'), JSON.stringify({ reconValid, reconChars: reconMd.length, o0ShingleOverlap: overlap.length, overlapSample: overlap.slice(0, 5), plantDetected: plantIn }, null, 2) + '\n')

  // 4. neutral bundles (O0 from C0 masked body; R0 from recon; N0 = none)
  const bundles = { O0: neutralProjection(o0Md, leaf.relDir), R0: reconValid ? neutralProjection(reconMd, leaf.relDir) : '', N0: null }

  // 5. O0/R0/N0 executor arms on the SAME frozen future task (arms differ only in injected bundle)
  const arms = {}
  for (const arm of ['O0', 'R0', 'N0']) {
    const armBase = join(base, `arm-${arm}`)
    const execDir = join(armBase, 'exec-snapshot')
    const bundleText = bundles[arm]
    const bundleArgs = bundleText ? ['--bundle-rel', `${leaf.relDir}/BUNDLE.md`, '--bundle-file', join(armBase, 'bundle.md')] : []
    if (bundleText) { mkdirSync(armBase, { recursive: true }); writeFileSync(join(armBase, 'bundle.md'), bundleText) }
    runTs(['exec-snapshot', '--commit', leaf.preState, '--governed', card.governedFile ?? (card.governedFiles ?? []).join(','), '--out', execDir, ...bundleArgs])
    const execManifest = JSON.parse(readFileSync(join(execDir, 'exec-manifest.json'), 'utf8'))
    if (!execManifest.strippedAllSpec || !execManifest.governedPresent) throw new Error(`BATCH-STOP: ${id}/${arm} exec snapshot invalid (strippedAllSpec=${execManifest.strippedAllSpec} governedPresent=${execManifest.governedPresent})`)
    const prompt = execPrompt(card.request)
    const run = await launchAgent({ runId: `${id}-${arm}`, snapshotDir: join(execDir, 'snapshot'), prompt,
      writeSubdir: '.', credPath, timeoutMs: 20 * 60_000, archiveDir: armBase, upstreamCommit: upstream })
    enforceRunGates(`${id}-${arm}`, run)
    // scope violations: files changed outside the governed set
    const governed = card.governedFile ? [card.governedFile] : (card.governedFiles ?? [])
    const preSnap = join(execDir, 'snapshot')
    const scope = scopeViolations(preSnap, run.workDir, governed)
    const score = scoreLeaf(id, run.workDir, card)
    writeFileSync(join(armBase, 'score.json'), JSON.stringify({ arm, score, scopeViolations: scope }, null, 2) + '\n')
    arms[arm] = { archive: armBase, trace: run.trace, scopeViolations: scope.length, score: { passed: score.passed, total: score.total } }
  }

  return {
    leaf: id, relDir: leaf.relDir, episode: leaf.episode.sha, preState: leaf.preState,
    recon: { valid: reconValid, chars: reconMd.length, o0Overlap: overlap.length, model: recon.trace.model.observedSet, tokens: recon.trace.tokens, durationMs: recon.trace.durationMs, archive: join(base, 'recon') },
    arms, upstream,
  }
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

function scopeViolations(preSnapDir, workDir, governed) {
  // files whose bytes differ from the pre-state snapshot but are NOT in the governed set
  const out = []
  const walk = (dir, base) => {
    for (const e of readdirSyncSafe(dir)) {
      const abs = join(dir, e), rel = abs.slice(base.length + 1)
      if (statSafe(abs)?.isDirectory()) { if (e !== '.git') walk(abs, base) }
      else {
        if (governed.includes(rel)) continue
        const pre = join(preSnapDir, rel)
        const a = existsSync(pre) ? readFileSafe(pre) : null
        const b = readFileSafe(abs)
        if (a === null || a !== b) out.push(rel)
      }
    }
  }
  if (workDir && existsSync(workDir)) walk(workDir, workDir)
  return out
}
const readdirSyncSafe = (d) => { try { return readdirSync(d) } catch { return [] } }
const statSafe = (p) => { try { return statSync(p) } catch { return null } }
const readFileSafe = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }

export async function leafPhase({ credPath }) {
  const tasks = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'))
  const cards = JSON.parse(readFileSync(join(HERE, 'task-cards.json'), 'utf8'))
  // the two leaf targets run in parallel; within a leaf the three arms are sequential (shared frozen task)
  const settled = await Promise.allSettled(tasks.leaves.map((leaf) => runLeaf(leaf, cards, tasks.c0, credPath)))
  const results = [], failures = []
  settled.forEach((s, i) => s.status === 'fulfilled' ? results.push(s.value) : failures.push({ leaf: tasks.leaves[i].id, error: String(s.reason?.message ?? s.reason) }))
  const report = { v: 1, at: nowIso(), phase: 'leaf', c0: tasks.c0, cEval: tasks.cEval, results, failures }
  writeFileSync(join(RUNS, 'pilot', 'leaf-report.json'), JSON.stringify(report, null, 2) + '\n')
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
  const r = await verifyModel({ credPath: opt('--cred', CRED_DEFAULT) })
  console.log(`verify-model: ok=${r.ok} exit=${r.exitCode} timedOut=${r.timedOut} modelClean=${r.modelClean} secretClean=${r.secretClean}`)
  console.log(`  observed model set: ${JSON.stringify(r.trace.model.observedSet)} (expected ${MODEL})`)
  console.log(`  tokens: in=${r.trace.tokens.input} cacheRead=${r.trace.tokens.cacheRead} out=${r.trace.tokens.output} duration=${r.trace.durationMs}ms`)
  console.log(`  archive: ${r.archiveDir}`)
  process.exit(r.ok ? 0 : 1)
} else if (sub === 'phase') {
  const scale = opt('--scale', 'leaf')
  if (scale !== 'leaf') { console.error(`only --scale leaf implemented in this stage (got ${scale})`); process.exit(2) }
  const report = await leafPhase({ credPath: opt('--cred', CRED_DEFAULT) })
  console.log(`\nleaf phase: ${report.results.length} leaves complete, ${report.failures.length} failed`)
  for (const r of report.results) {
    console.log(`  [${r.leaf}] recon valid=${r.recon.valid} chars=${r.recon.chars} o0Overlap=${r.recon.o0Overlap} model=${JSON.stringify(r.recon.model)}`)
    for (const a of ['O0', 'R0', 'N0']) console.log(`    ${a}: model=${JSON.stringify(r.arms[a].trace.model.observedSet)} score=${r.arms[a].score.passed}/${r.arms[a].score.total} scope-violations=${r.arms[a].scopeViolations} in/out=${r.arms[a].trace.tokens.input}/${r.arms[a].trace.tokens.output} ${r.arms[a].trace.durationMs}ms`)
  }
  for (const f of report.failures) console.log(`  BATCH-STOP [${f.leaf}]: ${f.error}`)
  process.exit(report.failures.length ? 1 : 0)
} else if (sub) {
  console.error(`unknown pilot subcommand: ${sub} (preflight | verify-model | phase --scale leaf)`)
  process.exit(2)
}
