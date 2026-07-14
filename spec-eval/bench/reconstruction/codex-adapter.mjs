// spec-reconstruction-bench Codex executor adapter ([[spec-reconstruction-bench]]).
//
// The executor is a REGISTRY of adapter rows (no `if (codex)` scattered in the phase): each row exposes
// the same launch(opts)→{ok,trace,modelClean,realCompletion,accountingValid,secretClean,apiError,...}
// contract as the GLM/sandbox row, so the phase treats them uniformly and NEVER mixes providers in a batch.
//
// ONE seam per pillar (no arm special-cases):
//   • parseCodexJsonl — PURE parser over raw `codex exec --json` lines: structure, order, unique terminal,
//     strict non-empty agent_message output, integer usage. It knows NOTHING about models and accepts NO
//     evidence parameters — there is no field a caller could forge.
//   • verifyTransportTrace — the ONE place model identity is established. Only the CONTROLLED transport
//     (the adapter's own trace proxy, or the fake transport in no-model tests) produces the trace events
//     it consumes; the expected provider/model is the adapter PIN (sub2api / gpt-5.5), never a parameter.
//   • launchCodex — the full isolated launch (per-run 0700 HOME/CODEX_HOME/CODEX_SQLITE_HOME, env
//     allowlist, structured argv, docker --network none, ssh-tunnel + unix-socket trace proxy as the only
//     egress). COMPLETE code, but hard-gated: unreachable until reviewerGo:true after a reviewer GO.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, renameSync, cpSync, appendFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { rawByteScan, scanTreeRaw, pinMountDigest } from './sandbox.mjs'

const HERE = new URL('.', import.meta.url).pathname

// ---- the adapter PIN: the only provider/model this adapter will ever launch or verify against ----
export const CODEX_PROVIDER = Object.freeze({ providerName: 'sub2api', model: 'gpt-5.5', wireApi: 'responses' })

// env allowlist — the ONLY vars a codex attempt may see (plus the per-run isolation vars we set).
export const CODEX_ENV_ALLOW = ['PATH', 'LANG', 'LC_ALL', 'TERM']

export function buildCodexArgv(slug) {
  if (!slug || typeof slug !== 'string') throw new Error('codex argv: model slug required (no guessing)')
  return ['exec', '--json', '--ephemeral', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'danger-full-access', '-m', slug]
}

// build the explicit, isolated env for one attempt. `authEnvName`/`authValue` inject the approved key via
// a per-run env var (never argv, never a global file). Ambient env is NOT inherited.
export function buildCodexEnv({ home, codexHome, sqliteHome, authEnvName, authValue, passthrough = {} }) {
  const env = {}
  for (const k of CODEX_ENV_ALLOW) if (typeof passthrough[k] === 'string') env[k] = passthrough[k]
  env.HOME = home
  env.CODEX_HOME = codexHome
  env.CODEX_SQLITE_HOME = sqliteHome
  if (authEnvName) { if (!authValue) throw new Error('codex env: authEnvName given without a value'); env[authEnvName] = authValue }
  return env
}

// temp CODEX_HOME/config.toml provider row (parameterized; no global config copy). Values are escaped.
// AUTH IS DECLARED, never implicit: `envKey` emits the provider row's `env_key` (codex 0.144.x semantics —
// the CLI reads the bearer token from THAT env var), so the credential binding is visible in the frozen
// config instead of riding on an undeclared auth.json.
export function codexConfigToml({ model, providerName, baseUrl, wireApi = 'responses', envKey = null }) {
  if (!model || !providerName || !baseUrl) throw new Error('codex config: model, providerName, baseUrl required')
  if (!/^[A-Za-z0-9_.-]+$/.test(providerName)) throw new Error('codex config: providerName must be a bare identifier')
  if (envKey !== null && !/^[A-Z][A-Z0-9_]*$/.test(envKey)) throw new Error('codex config: envKey must be an ENV_VAR-shaped name')
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    `model = "${esc(model)}"`,
    `model_provider = "${esc(providerName)}"`,
    '',
    `[model_providers.${providerName}]`,
    `name = "${esc(providerName)}"`,
    `base_url = "${esc(baseUrl)}"`,
    `wire_api = "${esc(wireApi)}"`,
    ...(envKey ? [`env_key = "${esc(envKey)}"`] : []),
    '',
  ].join('\n')
}

// STRICT PURE parser over codex exec --json output. Accepts RAW LINES (strings) and self-parses: ANY
// non-JSON / malformed line fails. Enforces the event ORDER thread.started < turn.started < turn.completed,
// a UNIQUE terminal (exactly one of each), at least ONE completed STRICT non-empty `agent_message` item
// (a user_message or any other item type never counts), and usage that is entirely finite nonnegative
// integers with cached<=input and reasoning<=output. It carries NO model fields and takes NO evidence
// parameters — model identity is verifyTransportTrace's job, out of any caller's reach.
export function parseCodexJsonl(rawLines) {
  const errors = []
  const lines = Array.isArray(rawLines) ? rawLines : String(rawLines).split('\n')
  const events = []
  lines.forEach((ln, i) => {
    const s = typeof ln === 'string' ? ln.trim() : JSON.stringify(ln)
    if (!s) return
    try { events.push({ i, e: JSON.parse(s) }) } catch { errors.push(`line ${i}: non-JSON/malformed`) }
  })
  const firstIdx = (t) => { const f = events.find((x) => x.e?.type === t); return f ? f.i : -1 }
  const cnt = (t) => events.filter((x) => x.e?.type === t).length
  for (const t of ['thread.started', 'turn.started', 'turn.completed']) { const c = cnt(t); if (c !== 1) errors.push(`${t} count=${c} (need exactly 1)`) }
  const iThread = firstIdx('thread.started'), iTurnStart = firstIdx('turn.started'), iTurnDone = firstIdx('turn.completed')
  if (iThread >= 0 && iTurnStart >= 0 && !(iThread < iTurnStart)) errors.push('order: thread.started must precede turn.started')
  if (iTurnStart >= 0 && iTurnDone >= 0 && !(iTurnStart < iTurnDone)) errors.push('order: turn.started must precede turn.completed')
  const threadStarted = events.find((x) => x.e?.type === 'thread.started')?.e
  const threadId = threadStarted?.thread_id ?? null
  if (cnt('thread.started') === 1 && !threadId) errors.push('thread.started has no thread_id')
  if (cnt('error') > 0) errors.push(`${cnt('error')} error event(s)`)
  if (cnt('turn.failed') > 0) errors.push(`${cnt('turn.failed')} turn.failed event(s)`)
  // at least one completed STRICT non-empty agent_message (item.type equality — user_message rejected)
  const agentMessages = events.filter((x) => x.e?.type === 'item.completed' && x.e?.item?.type === 'agent_message'
    && typeof x.e.item.text === 'string' && x.e.item.text.trim().length > 0)
  if (agentMessages.length === 0) errors.push('no completed non-empty agent_message output item')
  // usage = the UNIQUE terminal snapshot from turn.completed; every field a finite nonnegative integer
  const completed = events.find((x) => x.e?.type === 'turn.completed')?.e
  const u = completed?.usage ?? null
  let tokens = null
  const finiteNonNeg = (v) => Number.isInteger(v) && v >= 0
  if (u) {
    const fields = { input: u.input_tokens, output: u.output_tokens, cached: u.cached_input_tokens ?? 0, reasoning: u.reasoning_output_tokens ?? 0 }
    for (const [k, v] of Object.entries(fields)) if (!finiteNonNeg(v)) errors.push(`usage.${k}=${v} not a finite nonnegative integer`)
    if (finiteNonNeg(fields.cached) && finiteNonNeg(fields.input) && fields.cached > fields.input) errors.push(`cached ${fields.cached} > input ${fields.input}`)
    if (finiteNonNeg(fields.reasoning) && finiteNonNeg(fields.output) && fields.reasoning > fields.output) errors.push(`reasoning ${fields.reasoning} > output ${fields.output}`)
    tokens = fields
  } else if (cnt('turn.completed') === 1) errors.push('turn.completed carries no usage snapshot')
  return { ok: errors.length === 0, errors, threadId, tokens, output: agentMessages.map((x) => x.e.item.text) }
}

// THE transport seam: model identity comes ONLY from trace events the controlled transport itself
// recorded ({status, requestId, model} per upstream response). Expected model/provider is the adapter
// PIN — not a parameter — so there is nothing for a caller to supply or forge. The fake transport in
// no-model tests produces the same event shape and is verified through this same function.
export function verifyTransportTrace(traceEvents) {
  const errors = []
  const evs = Array.isArray(traceEvents) ? traceEvents : []
  if (evs.length === 0) errors.push('transport recorded no upstream responses')
  const models = [...new Set(evs.map((e) => e?.model).filter(Boolean))]
  if (evs.length > 0 && (models.length !== 1 || models[0] !== CODEX_PROVIDER.model)) {
    errors.push(`observed model set ${JSON.stringify(models)} != {${CODEX_PROVIDER.model}}`)
  }
  if (evs.some((e) => !(Number.isInteger(e?.status) && e.status >= 200 && e.status < 300))) errors.push('non-2xx response in transport trace')
  return { verified: errors.length === 0, errors, models, responses: evs.length }
}

// ---- REAL launch — COMPLETE isolated implementation, hard-gated (uncalled until reviewer GO). ----
// Reads global ~/.codex/auth.json ONLY at call time (unreachable now), stages ONLY the relay key into a
// per-run mode-0700 CODEX_HOME, never modifies/archives/prints the globals. The key never crosses the
// public internet in the clear: per-run `ssh -N -L` tunnel to the vps sub2api is the egress, reached from
// `docker --network none` through ONE unix-socket hop — an HTTP trace proxy that privately records ONLY
// {status, request-id, response model} per response (never headers/bodies/keys). Model identity is then
// judged by verifyTransportTrace against the adapter PIN. finally kills ssh+proxy+container, rm's scratch.
const CODEX_GLOBAL_DIR = '/home/jeffry/.codex'                       // read at call time ONLY (gated)
const CODEX_SSH_CONFIG = '/home/jeffry/YellowPage/ssh_config'
const CODEX_SSH_TARGET = 'public-vps-tail'
const CODEX_UPSTREAM = { host: '127.0.0.1', port: 18080 }            // sub2api on the vps (via the tunnel)
const CODEX_BRIDGE_PORT = 18081                                      // in-container loopback listen port
export const CODEX_NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
export const CODEX_PKG = `${CODEX_NODE_DIST}/lib/node_modules/@openai/codex`
export const CODEX_IMAGE = 'scb-spexcode-base:0.4.0'
const CODEX_AUTH_ENV = 'OPENAI_API_KEY'                              // declared in the TOML via env_key

// PINNED codex provenance (image id, codex version + package digest, node digest, runner commit) —
// computed once; the per-launch mount digests (pinMountDigest) then re-verify every mutable input on
// every launch, so a swapped binary/package mid-batch is fail-loud.
let CODEX_PROVENANCE = null
export function codexProvenance() {
  if (CODEX_PROVENANCE) return CODEX_PROVENANCE
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  const safe = (fn, d = null) => { try { return fn() } catch { return d } }
  CODEX_PROVENANCE = {
    dockerImage: CODEX_IMAGE,
    dockerImageId: safe(() => execFileSync('docker', ['image', 'inspect', CODEX_IMAGE, '--format', '{{.Id}}'], { encoding: 'utf8' }).trim()),
    codexVersion: safe(() => JSON.parse(readFileSync(join(CODEX_PKG, 'package.json'), 'utf8')).version),
    codexPkgDigest: safe(() => sha(readFileSync(join(CODEX_PKG, 'package.json')) + '::' + sha(readFileSync(join(CODEX_PKG, 'bin', 'codex.js')))).slice(0, 16)),
    nodeDigest: safe(() => sha(readFileSync(join(CODEX_NODE_DIST, 'bin', 'node')).subarray(0, 1 << 20)).slice(0, 16)),
    runnerCommit: safe(() => execFileSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()),
    provider: CODEX_PROVIDER,
  }
  return CODEX_PROVENANCE
}

export async function launchCodex(opts) {
  const { reviewerGo, provider, prompt, snapshotDir, archiveDir, runId = 'codex-run' } = opts ?? {}
  const timeoutMs = opts?.timeoutMs ?? 20 * 60_000
  // HARD GUARD — unreachable until a reviewer GO explicitly authorizes it. Everything below is complete
  // and reviewable, but no global-auth read, no ssh tunnel, no paid call happens before that GO.
  if (reviewerGo !== true) {
    throw new Error('launchCodex BLOCKED: awaiting reviewer GO. No global-auth read, no ssh tunnel, no model gate. ' +
      'The phase must pass {reviewerGo:true} only after re-review; provider/model are the adapter pin, not caller input.')
  }
  // the provider is the adapter PIN — a caller may restate it, never change it, and passes NO evidence.
  for (const k of ['providerName', 'model', 'wireApi']) {
    if (provider && provider[k] !== undefined && provider[k] !== CODEX_PROVIDER[k]) {
      throw new Error(`launchCodex: provider.${k}=${provider[k]} conflicts with the adapter pin ${CODEX_PROVIDER[k]} — no caller override`)
    }
  }
  if (!prompt || !archiveDir) throw new Error('launchCodex: prompt + archiveDir required')

  const started = new Date().toISOString()
  const t0 = Date.now()
  // provenance: pinned once + EVERY mutable ro mount content-digested and re-verified on THIS launch
  const provenance = codexProvenance()
  if (!provenance.dockerImageId) throw new Error('codex: docker image id unresolved — cannot pin an immutable image')
  const mounts = {
    node: pinMountDigest('codex:node-dist', CODEX_NODE_DIST),
    codexPkg: pinMountDigest('codex:pkg', CODEX_PKG),
    bridge: pinMountDigest('codex:bridge-driver', join(HERE, 'bridge.mjs')),
  }
  const http = await import('node:http')
  const scratch = mkdtempSync(join(tmpdir(), 'srb-codex-run-')); chmodSync(scratch, 0o700)
  const home = join(scratch, 'home'), codexHome = join(scratch, 'codex'), sqliteHome = join(scratch, 'sqlite'), workDir = join(scratch, 'work')
  for (const d of [home, codexHome, sqliteHome, workDir]) { mkdirSync(d, { recursive: true }); chmodSync(d, 0o700) }
  const sockPath = join(scratch, 'codex.sock')
  // provider trace lives ONLY inside this closure — no parameter carries it in, no field leaks it out raw
  const traceEvents = []
  const containerName = `srb-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, '-')
  let ssh = null, proxy = null, docker = null, killer = null, timedOut = false
  const cleanup = () => {
    try { if (killer) clearTimeout(killer) } catch {}
    try { execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' }) } catch {}
    try { if (docker && !docker.killed) docker.kill('SIGKILL') } catch {}
    try { if (proxy) proxy.close() } catch {}
    try { if (ssh && !ssh.killed) ssh.kill('SIGKILL') } catch {}
    try { rmSync(scratch, { recursive: true, force: true }) } catch {}
  }
  try {
    // 1. relay key: read-only, call-time only; injected ONLY via the DECLARED env_key variable in a 0600
    //    env-file (the TOML provider row states env_key — the binding is visible, never implicit)
    const authRaw = JSON.parse(readFileSync(join(CODEX_GLOBAL_DIR, 'auth.json'), 'utf8'))
    const relayKey = authRaw?.OPENAI_API_KEY ?? authRaw?.tokens?.access_token
    if (!relayKey) throw new Error('no relay key in global auth.json')
    // 2. per-run ssh tunnel to the vps sub2api
    const localPort = pickEphemeralPort(execFileSync)
    ssh = spawn('ssh', ['-F', CODEX_SSH_CONFIG, '-N', '-o', 'ExitOnForwardFailure=yes',
      '-L', `127.0.0.1:${localPort}:${CODEX_UPSTREAM.host}:${CODEX_UPSTREAM.port}`, CODEX_SSH_TARGET], { stdio: ['ignore', 'ignore', 'pipe'] })
    await waitTunnel(localPort, execFileSync)
    // 3. controlled trace proxy on a per-run unix socket: forwards HTTP to the tunnel and PRIVATELY
    //    records {status, requestId, model} per response (model via regex over the first 64KB — the body
    //    itself is never archived and the key never enters the trace).
    proxy = http.createServer((req, res) => {
      const up = http.request({ host: '127.0.0.1', port: localPort, method: req.method, path: req.url, headers: req.headers }, (ur) => {
        let head = Buffer.alloc(0)
        ur.on('data', (c) => { if (head.length < 65536) head = Buffer.concat([head, c]) })
        ur.on('end', () => {
          const m = head.toString('utf8').match(/"model"\s*:\s*"([^"]+)"/)
          traceEvents.push({ at: new Date().toISOString(), status: ur.statusCode, requestId: ur.headers['x-request-id'] ?? null, model: m ? m[1] : null })
        })
        res.writeHead(ur.statusCode, ur.headers)
        ur.pipe(res)
      })
      up.on('error', () => { try { res.destroy() } catch {} })
      req.pipe(up)
    })
    await new Promise((resolve, reject) => { proxy.on('error', reject); proxy.listen(sockPath, resolve) })
    // 4. per-run config.toml: provider row = the adapter pin; auth DECLARED via env_key; base_url = bridge
    const configToml = codexConfigToml({
      model: CODEX_PROVIDER.model, providerName: CODEX_PROVIDER.providerName,
      baseUrl: `http://127.0.0.1:${CODEX_BRIDGE_PORT}/v1`, wireApi: CODEX_PROVIDER.wireApi, envKey: CODEX_AUTH_ENV,
    })
    writeFileSync(join(codexHome, 'config.toml'), configToml)
    const configHash = createHash('sha256').update(configToml).digest('hex')
    // 5. isolated container run: --network none; bridge ns → unix socket → trace proxy → tunnel
    if (snapshotDir) cpSync(snapshotDir, workDir, { recursive: true })
    const promptMount = join(scratch, 'PROMPT.md'); writeFileSync(promptMount, prompt)
    const env = buildCodexEnv({ home: '/agent', codexHome: '/agent/codex', sqliteHome: '/agent/sqlite',
      authEnvName: CODEX_AUTH_ENV, authValue: relayKey,
      passthrough: { PATH: '/usr/bin:/bin:/opt/node/bin', LANG: 'C.UTF-8' } })
    const envFile = join(scratch, 'codex.env')
    writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); chmodSync(envFile, 0o600)
    const inner = [
      'set -e',
      `/opt/node/bin/node /assets/bridge.mjs ns /run/codex.sock ${CODEX_BRIDGE_PORT} 2>/agent/bridge-ns.log &`,
      'sleep 0.4',
      `cd /work && /opt/node/bin/node /opt/codex/bin/codex.js ${buildCodexArgv(CODEX_PROVIDER.model).join(' ')} "$(cat /assets/PROMPT.md)"`,
    ].join('\n')
    const args = ['run', '--rm', '--name', containerName, '--user', '1000:1000', '--network', 'none',
      '--env-file', envFile, '--read-only', '--tmpfs', '/tmp:exec,uid=1000',
      '-v', `${CODEX_NODE_DIST}:/opt/node:ro`, '-v', `${CODEX_PKG}:/opt/codex:ro`,
      '-v', `${join(HERE, 'bridge.mjs')}:/assets/bridge.mjs:ro`, '-v', `${promptMount}:/assets/PROMPT.md:ro`,
      '-v', `${workDir}:/work`, '-v', `${sockPath}:/run/codex.sock`,
      '-v', `${codexHome}:/agent/codex`, '-v', `${sqliteHome}:/agent/sqlite`,
      '--tmpfs', '/agent:exec,uid=1000,gid=1000,mode=0700',
      provenance.dockerImageId, 'bash', '-c', inner]
    const out = [], errBuf = []
    docker = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    docker.stdout.on('data', (d) => out.push(d.toString()))
    docker.stderr.on('data', (d) => errBuf.push(d.toString()))
    const exit = await new Promise((resolve) => {
      killer = setTimeout(() => { timedOut = true; try { execFileSync('docker', ['kill', containerName], { stdio: 'ignore' }) } catch {}; try { docker.kill('SIGKILL') } catch {} }, timeoutMs)
      docker.on('close', (code) => { clearTimeout(killer); resolve(code) })
      docker.on('error', () => { clearTimeout(killer); resolve(-1) })
    })
    // 6. parse (pure) + transport verdict (the seam) + FAIL-CLOSED secret scan over EVERYTHING archived
    const rawOut = out.join(''), rawErr = errBuf.join('')
    const parsed = parseCodexJsonl(rawOut.split('\n'))
    const transport = verifyTransportTrace(traceEvents)
    const b64 = Buffer.from(relayKey).toString('base64')
    const redact = (s) => s.split(relayKey).join('«REDACTED-KEY»').split(b64).join('«REDACTED-KEY-B64»')
    mkdirSync(archiveDir, { recursive: true })
    const workOut = join(archiveDir, 'workspace')
    rmSync(workOut, { recursive: true, force: true })
    cpSync(workDir, workOut, { recursive: true })
    const streamHits = rawByteScan(Buffer.from(rawOut + '\n' + rawErr + '\n' + prompt, 'utf8'), relayKey)
    const wsScan = scanTreeRaw(workOut, relayKey)
    const secretClean = !wsScan.scanError && streamHits.keyHits + wsScan.keyHits === 0
      && streamHits.prefixHits + wsScan.prefixHits === 0 && streamHits.b64Hits + wsScan.b64Hits === 0
    writeFileSync(join(archiveDir, 'PROMPT.md'), redact(prompt))
    writeFileSync(join(archiveDir, 'transcript.jsonl'), redact(rawOut))
    const errSummary = redact(rawErr).split('\n').filter((l) => l.trim()).slice(-40).join('\n')
    if (errSummary) writeFileSync(join(archiveDir, 'stderr.summary.txt'), errSummary + '\n')
    // trace: complete + sanitized — statuses/request-ids/actual model from the transport closure, thread
    // set, raw terminal usage, full provenance (image id, codex version+digest, node/bridge/pkg digests,
    // runner commit, config hash). Never headers/bodies/keys.
    const apiError = transport.verified ? null
      : (traceEvents.some((e) => e.status && (e.status < 200 || e.status >= 300))
        ? `upstream non-2xx: ${[...new Set(traceEvents.map((e) => e.status))].join(',')}` : null)
    const trace = {
      v: 2, runId, adapter: 'codex', started, ended: new Date().toISOString(), durationMs: Date.now() - t0,
      exitCode: exit, timedOut,
      httpStatuses: [...new Set(traceEvents.map((e) => e.status))],
      requestIds: traceEvents.map((e) => e.requestId).filter(Boolean),
      threadIds: parsed.threadId ? [parsed.threadId] : [],
      model: { observedSet: transport.models, expected: CODEX_PROVIDER.model, clean: transport.verified, realCompletion: parsed.ok && (parsed.tokens?.output ?? 0) > 0 },
      usage: parsed.tokens,
      parsed: { ok: parsed.ok, errors: parsed.errors },
      transport: { verified: transport.verified, errors: transport.errors, responses: transport.responses },
      apiError,
      provenance: { ...provenance, mounts, configSha256: configHash },
      secretScan: { keyHits: streamHits.keyHits + wsScan.keyHits, prefixHits: streamHits.prefixHits + wsScan.prefixHits, b64Hits: streamHits.b64Hits + wsScan.b64Hits, scanner: 'scanTreeRaw', scanError: wsScan.scanError, scanErrors: wsScan.errors, scannedFiles: wsScan.scannedFiles, clean: secretClean },
    }
    writeFileSync(join(archiveDir, 'trace.json'), JSON.stringify(trace, null, 2) + '\n')
    // fail-closed quarantine, same discipline as the GLM row: unclean archive is moved aside, LOUDLY
    if (!secretClean) {
      const q = archiveDir + '.QUARANTINE'
      if (existsSync(q)) throw new Error(`FATAL: quarantine target already exists: ${q} — resolve manually; do not publish`)
      renameSync(archiveDir, q)
      if (existsSync(archiveDir) || !existsSync(q)) throw new Error(`FATAL: quarantine rename ${archiveDir} → ${q} did not take effect — do not publish`)
      return { ok: false, exitCode: exit, timedOut, modelClean: transport.verified, realCompletion: trace.model.realCompletion, accountingValid: parsed.ok, apiError, secretClean: false, quarantined: true, trace, archiveDir: q, workDir: null, usage: parsed.tokens, durationMs: trace.durationMs }
    }
    // UNIFIED runner contract — identical shape to the GLM row; enforceRunGates never learns the harness
    const ok = exit === 0 && !timedOut && parsed.ok && transport.verified && secretClean
    return { ok, exitCode: exit, timedOut, modelClean: transport.verified, realCompletion: trace.model.realCompletion, accountingValid: parsed.ok, apiError, secretClean, trace, archiveDir, workDir: workOut, usage: parsed.tokens, durationMs: trace.durationMs }
  } finally {
    cleanup()
  }
}
// runtime-only helpers (reached only post-GO): pick a free loopback port; wait for the tunnel to accept.
function pickEphemeralPort(execFileSync) {
  const out = execFileSync('bash', ['-c', "for p in $(seq 45000 45999); do ss -tlnH \"sport = :$p\" | grep -q . || { echo $p; break; }; done"], { encoding: 'utf8' }).trim()
  if (!out) throw new Error('no free ephemeral port for the codex tunnel')
  return Number(out)
}
async function waitTunnel(port, execFileSync) {
  for (let i = 0; i < 40; i++) {
    try { execFileSync('bash', ['-c', `ss -tlnH "sport = :${port}" | grep -q .`]); return } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`codex ssh tunnel did not come up on 127.0.0.1:${port}`)
}

// FAKE adapter for no-model tests: canned JSONL LINES through the SAME plumbing, and a FAKE TRANSPORT
// producing the same trace-event shape the real proxy records — verified through the SAME seam
// (verifyTransportTrace). Returns raw line arrays; the parser self-parses.
export function fakeCodexLines(kind = 'good', { secret = null } = {}) {
  const J = (o) => JSON.stringify(o)
  const good = [
    J({ type: 'thread.started', thread_id: 'th_fake_001' }),
    J({ type: 'turn.started' }),
    J({ type: 'item.completed', item: { type: 'agent_message', text: secret ? `leaked ${secret}` : 'ok' } }),
    J({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10 } }),
  ]
  if (kind === 'good') return good
  if (kind === 'malformed-line') return [good[0], '{not json', good[1], good[2], good[3]]
  if (kind === 'out-of-order') return [good[1], good[0], good[2], good[3]]            // turn.started before thread.started
  if (kind === 'dup-thread') return [good[0], J({ type: 'thread.started', thread_id: 'th_x' }), good[1], good[2], good[3]]
  if (kind === 'missing-completed') return good.slice(0, 3)
  if (kind === 'no-assistant-item') return [good[0], good[1], good[3]]                 // no item.completed at all
  if (kind === 'user-message-item') return [good[0], good[1], J({ type: 'item.completed', item: { type: 'user_message', text: 'echoed prompt' } }), good[3]]
  if (kind === 'empty-agent-message') return [good[0], good[1], J({ type: 'item.completed', item: { type: 'agent_message', text: '   ' } }), good[3]]
  if (kind === 'turn-failed') return [good[0], good[1], J({ type: 'turn.failed', error: 'boom' })]
  if (kind === 'error-event') return [good[0], J({ type: 'error', message: 'x' }), good[1], good[2], good[3]]
  if (kind === 'bad-usage') return [good[0], good[1], good[2], J({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 5, reasoning_output_tokens: 0 } })]
  if (kind === 'nonint-usage') return [good[0], good[1], good[2], J({ type: 'turn.completed', usage: { input_tokens: 1.5, output_tokens: 2, cached_input_tokens: 0, reasoning_output_tokens: 0 } })]
  return good
}

// fake transport trace events (same shape the real proxy records) — judged by the SAME verifyTransportTrace.
export function fakeTransportTrace(kind = 'good') {
  if (kind === 'good') return [{ at: 'fake', status: 200, requestId: 'req_fake_1', model: CODEX_PROVIDER.model }]
  if (kind === 'wrong-model') return [{ at: 'fake', status: 200, requestId: 'req_fake_1', model: 'other-model' }]
  if (kind === 'no-model') return [{ at: 'fake', status: 200, requestId: 'req_fake_1', model: null }]
  if (kind === 'empty') return []
  if (kind === 'non-2xx') return [{ at: 'fake', status: 500, requestId: 'req_fake_1', model: CODEX_PROVIDER.model }]
  return []
}

// isolate + run the fake codex plumbing: returns the argv/env/config it WOULD run with + parsed result +
// the transport verdict from the fake transport (same seam as the real launch). Proves per-run temp
// HOME/CODEX_HOME (not ~/.codex), env allowlist, structured argv, cleanup, secret scan.
export function fakeCodexAttempt({ kind = 'good', transportKind = 'good', secretKey = null, scanFn = null, authEnvName = null, authValue = null }) {
  const root = mkdtempSync(join(tmpdir(), 'srb-codex-'))
  const home = join(root, 'home'), codexHome = join(root, 'codex'), sqliteHome = join(root, 'sqlite')
  let result
  try {
    for (const d of [home, codexHome, sqliteHome]) mkdirSync(d, { recursive: true })
    const argv = buildCodexArgv(CODEX_PROVIDER.model)
    const env = buildCodexEnv({ home, codexHome, sqliteHome, authEnvName, authValue, passthrough: { PATH: '/usr/bin:/bin' } })
    writeFileSync(join(codexHome, 'config.toml'), codexConfigToml({ model: CODEX_PROVIDER.model, providerName: CODEX_PROVIDER.providerName, baseUrl: 'http://127.0.0.1:18081/v1', wireApi: CODEX_PROVIDER.wireApi }))
    chmodSync(codexHome, 0o700); chmodSync(home, 0o700)
    const lines = fakeCodexLines(kind, { secret: secretKey })
    const jsonl = lines.join('\n')
    const parsed = parseCodexJsonl(lines)                                   // pure — no evidence enters
    const transport = verifyTransportTrace(fakeTransportTrace(transportKind))  // the ONE model seam
    result = {
      argv, envNames: Object.keys(env).sort(), homeUnderTmp: home.startsWith(tmpdir()),
      touchesGlobalCodex: [home, codexHome, sqliteHome].some((p) => p.includes('/.codex')),
      parsed, transport, modelVerified: transport.verified,
      secretScanResult: scanFn && secretKey ? scanFn(jsonl, secretKey) : null,
      configHasProvider: existsSync(join(codexHome, 'config.toml')),
      root,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  result.cleanedUp = !existsSync(root)
  return result
}

// the composed executor registry (glm + codex + fake rows, one launch contract) lives in registry.mjs —
// this module only exports the codex row's parts.
