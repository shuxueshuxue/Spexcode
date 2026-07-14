// spec-reconstruction-bench Codex executor adapter ([[spec-reconstruction-bench]]).
//
// The executor is a REGISTRY of adapter rows (no `if (codex)` scattered in the phase): each row exposes
// the same launch(opts)→{ok,trace,modelClean,realCompletion,accountingValid,secretClean,apiError,...}
// contract as the GLM/sandbox row, so the phase treats them uniformly and NEVER mixes providers in a batch.
//
// Codex row (approved as the alternative while GLM is 429-held). Isolation, per the scout:
//   • per-ATTEMPT mode-0700 HOME + CODEX_HOME + CODEX_SQLITE_HOME (throwaway); NEVER read/write ~/.codex.
//   • `env -i` with an EXPLICIT allowlist — no inheritance of the ambient environment.
//   • STRUCTURED argv (never a split string): codex exec --json --ephemeral --ignore-rules
//     --skip-git-repo-check --sandbox danger-full-access -m <slug>.
//   • outer clean no-network / controlled-egress container is still the security boundary.
//   • temp CODEX_HOME/config.toml carries the provider row (model / model_provider / base_url /
//     wire_api=responses); auth ONLY via an approved per-run env var or an auth-command helper — never a
//     copy of ~/.codex/auth.json.
// Parser is strict (parseCodexJsonl): EXACTLY one thread.started (+thread_id), one turn.started, one
// turn.completed; any error/turn.failed/malformed/duplicate/missing/nonzero fails; usage is the UNIQUE
// terminal snapshot (never summed) with cached<=input and reasoning<=output. The CLI JSONL carries NO
// actual model id, so modelVerified REQUIRES a separate provider response trace — else false.
//
// REAL launch is BLOCKED here on purpose: there is no repo-local approved sub2api endpoint, credential
// retrieval path, or exact model slug. launchCodex throws until a config object with all three is passed
// by an authorized caller. This module ships the parameterized shape + a FAKE adapter for no-model tests.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
export function codexConfigToml({ model, providerName, baseUrl, wireApi = 'responses' }) {
  if (!model || !providerName || !baseUrl) throw new Error('codex config: model, providerName, baseUrl required')
  if (!/^[A-Za-z0-9_.-]+$/.test(providerName)) throw new Error('codex config: providerName must be a bare identifier')
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    `model = "${esc(model)}"`,
    `model_provider = "${esc(providerName)}"`,
    '',
    `[model_providers.${providerName}]`,
    `name = "${esc(providerName)}"`,
    `base_url = "${esc(baseUrl)}"`,
    `wire_api = "${esc(wireApi)}"`,
    '',
  ].join('\n')
}

// STRICT parser over codex exec --json output. Accepts RAW LINES (strings) and self-parses: ANY non-JSON
// / malformed line fails. Enforces the event ORDER thread.started < turn.started < turn.completed, a UNIQUE
// terminal (exactly one of each), at least ONE completed assistant output item, and usage that is entirely
// finite nonnegative integers with cached<=input and reasoning<=output. It does NOT establish model
// identity — the CLI JSONL carries no model id, so modelVerified is the CONTROLLED HTTP TRANSPORT's job
// (transportModelTrace), never caller-supplied evidence.
export function parseCodexJsonl(rawLines, { transportModelTrace = null, expectedModel = null } = {}) {
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
  // at least one COMPLETED assistant output item
  const hasAssistantItem = events.some((x) => x.e?.type === 'item.completed' && /assistant|message/.test(x.e?.item?.type ?? ''))
  if (!hasAssistantItem) errors.push('no completed assistant output item')
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
  // model verification is ONLY from the controlled transport's own extraction — never caller evidence
  const modelVerified = !!transportModelTrace && transportModelTrace.source === 'controlled-http-transport'
    && !!transportModelTrace.model && (!expectedModel || transportModelTrace.model === expectedModel)
  return { ok: errors.length === 0, errors, threadId, tokens, modelVerified }
}

// REAL launch — UNCALLED DRAFT. Hard-guarded: unreachable unless the phase passes reviewerGo:true (only
// set AFTER a reviewer GO — never set in this build). Reads global ~/.codex ONLY at call time (guarded
// off now), copies ONLY the relay key + the sub2api provider row into a per-run mode-0700 CODEX_HOME,
// never modifies/archives/prints the globals, and deletes the temp after. The key never crosses the
// public internet in the clear: a per-run `ssh -N -L 127.0.0.1:<ephemeral>:127.0.0.1:18080 public-vps-tail`
// tunnel is the egress, reached from the outer `docker --network none` container through a single
// unix/loopback bridge; codex's provider base_url points at that in-container loopback port. A controlled
// HTTP trace-proxy on the host bridge extracts ONLY status / request-id / response model / token counts
// (never header/body/key); actual model MUST be gpt-5.5. finally kills ssh + bridge + container and rm's
// the temp CODEX_HOME. This body is a reviewable draft; it stays uncalled until the paid gate.
const CODEX_GLOBAL_DIR = '/home/jeffry/.codex'                       // read-only, at call time ONLY
const CODEX_SSH_CONFIG = '/home/jeffry/YellowPage/ssh_config'
const CODEX_SSH_TARGET = 'public-vps-tail'
const CODEX_UPSTREAM = { host: '127.0.0.1', port: 18080 }           // sub2api on the vps (via the tunnel)

export async function launchCodex(opts) {
  const { provider, reviewerGo } = opts ?? {}
  // HARD GUARD — the draft is unreachable until a reviewer GO explicitly authorizes it.
  if (reviewerGo !== true) {
    throw new Error('launchCodex BLOCKED (uncalled draft): awaiting reviewer GO. No global-auth read, no ssh tunnel, no model gate. ' +
      'The phase must pass {reviewerGo:true, provider:{model:"gpt-5.5", providerName, wireApi:"responses"}} only after re-review.')
  }
  if (!provider?.model || !provider?.providerName) throw new Error('launchCodex: provider.model + providerName required (no guessing the slug)')

  // ---- the following runs ONLY post-GO (guarded above); wired here for review, exercised at the paid gate ----
  const { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync, existsSync } = await import('node:fs')
  const { spawn, execFileSync } = await import('node:child_process')
  const os = await import('node:os')
  const scratch = mkdtempSync(join(os.tmpdir(), 'srb-codex-run-'))
  chmodSync(scratch, 0o700)
  const codexHome = join(scratch, 'codex'); mkdirSync(codexHome, { recursive: true }); chmodSync(codexHome, 0o700)
  let ssh = null, bridge = null
  try {
    // 1. stage ONLY the necessary bytes from the read-only globals into the per-run CODEX_HOME.
    //    (relay key from auth.json; sub2api base_url/wire_api/model from config.toml — verified against the
    //    approved values: base_url http://64.83.11.237:18080, wire_api responses, model gpt-5.5.)
    if (!existsSync(join(CODEX_GLOBAL_DIR, 'auth.json'))) throw new Error('global codex auth.json absent')
    const relayKey = JSON.parse(readFileSync(join(CODEX_GLOBAL_DIR, 'auth.json'), 'utf8'))?.OPENAI_API_KEY
      ?? JSON.parse(readFileSync(join(CODEX_GLOBAL_DIR, 'auth.json'), 'utf8'))?.tokens?.access_token
    if (!relayKey) throw new Error('no relay key in global auth.json')
    // 2. per-run ssh tunnel: pick an ephemeral local port, forward it to the vps sub2api over the ssh_config host.
    const localPort = pickEphemeralPort(execFileSync)
    ssh = spawn('ssh', ['-F', CODEX_SSH_CONFIG, '-N', '-o', 'ExitOnForwardFailure=yes',
      '-L', `127.0.0.1:${localPort}:${CODEX_UPSTREAM.host}:${CODEX_UPSTREAM.port}`, CODEX_SSH_TARGET], { stdio: ['ignore', 'ignore', 'pipe'] })
    await waitTunnel(localPort, execFileSync)
    // 3. host trace-proxy + unix bridge: a controlled HTTP proxy in front of the tunnel records ONLY
    //    {status, request-id, response model, tokens} per response, then the outer container reaches it
    //    through a single unix/loopback bridge (bridge.mjs). base_url in config.toml points at the
    //    in-container loopback port. (Wiring identical in shape to sandbox.mjs's bridge; provider-trace
    //    hook added on the host half.)
    const traceFile = join(scratch, 'provider-trace.jsonl')
    // ... bridge + docker run of `codex ${buildCodexArgv(provider.model).join(' ')}` with CODEX_HOME staged,
    //     env buildCodexEnv({...}), --network none, provider base_url = in-container bridge; captures JSONL.
    //     Parsed with parseCodexJsonl(events, {providerModelTrace: fromTrace(traceFile, provider.model)}).
    throw new Error('launchCodex: paid container run intentionally not exercised in this commit — draft wiring only')
  } finally {
    try { if (bridge) bridge.kill('SIGKILL') } catch {}
    try { if (ssh) ssh.kill('SIGKILL') } catch {}
    try { rmSync(scratch, { recursive: true, force: true }) } catch {}
    // NOTE: global ~/.codex is only READ above — never modified, archived, or printed.
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

// FAKE adapter for no-model tests: emits canned JSONL LINES through the SAME isolation plumbing.
// Returns an array of RAW LINES (strings) — the parser self-parses and any non-JSON line fails.
export function fakeCodexLines(kind = 'good', { secret = null } = {}) {
  const J = (o) => JSON.stringify(o)
  const good = [
    J({ type: 'thread.started', thread_id: 'th_fake_001' }),
    J({ type: 'turn.started' }),
    J({ type: 'item.completed', item: { type: 'assistant_message', text: secret ? `leaked ${secret}` : 'ok' } }),
    J({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10 } }),
  ]
  if (kind === 'good') return good
  if (kind === 'malformed-line') return [good[0], '{not json', good[1], good[2], good[3]]
  if (kind === 'out-of-order') return [good[1], good[0], good[2], good[3]]            // turn.started before thread.started
  if (kind === 'dup-thread') return [good[0], J({ type: 'thread.started', thread_id: 'th_x' }), good[1], good[2], good[3]]
  if (kind === 'missing-completed') return good.slice(0, 3)
  if (kind === 'no-assistant-item') return [good[0], good[1], good[3]]                 // no item.completed
  if (kind === 'turn-failed') return [good[0], good[1], J({ type: 'turn.failed', error: 'boom' })]
  if (kind === 'error-event') return [good[0], J({ type: 'error', message: 'x' }), good[1], good[2], good[3]]
  if (kind === 'bad-usage') return [good[0], good[1], good[2], J({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 5, reasoning_output_tokens: 0 } })]
  if (kind === 'nonint-usage') return [good[0], good[1], good[2], J({ type: 'turn.completed', usage: { input_tokens: 1.5, output_tokens: 2, cached_input_tokens: 0, reasoning_output_tokens: 0 } })]
  return good
}

// isolate + run the fake codex plumbing: returns the argv/env/config it WOULD run with + parsed result.
// Proves per-run temp HOME/CODEX_HOME (not ~/.codex), env allowlist, structured argv, cleanup, secret scan.
export function fakeCodexAttempt({ slug, provider, kind = 'good', secretKey = null, scanFn = null }) {
  const root = mkdtempSync(join(tmpdir(), 'srb-codex-'))
  const home = join(root, 'home'), codexHome = join(root, 'codex'), sqliteHome = join(root, 'sqlite')
  let result
  try {
    for (const d of [home, codexHome, sqliteHome]) mkdirSync(d, { recursive: true })
    const argv = buildCodexArgv(slug)
    const env = buildCodexEnv({ home, codexHome, sqliteHome, authEnvName: provider?.authEnvName, authValue: provider?.authValue, passthrough: { PATH: '/usr/bin:/bin' } })
    writeFileSync(join(codexHome, 'config.toml'), codexConfigToml({ model: provider.model, providerName: provider.providerName, baseUrl: provider.baseUrl, wireApi: provider.wireApi }))
    chmodSync(codexHome, 0o700); chmodSync(home, 0o700)
    const lines = fakeCodexLines(kind, { secret: secretKey })
    const jsonl = lines.join('\n')
    // NO caller-supplied model evidence — a fake "controlled-transport" trace is only used to exercise the
    // transport-source gate; a caller-forged trace (wrong source) must NOT verify.
    const parsed = parseCodexJsonl(lines, { transportModelTrace: provider?.transportTrace ?? null, expectedModel: provider?.model })
    result = {
      argv, envNames: Object.keys(env).sort(), homeUnderTmp: home.startsWith(tmpdir()),
      touchesGlobalCodex: [home, codexHome, sqliteHome].some((p) => p.includes('/.codex')),
      parsed, secretScanResult: scanFn && secretKey ? scanFn(jsonl, secretKey) : null,
      configHasProvider: existsSync(join(codexHome, 'config.toml')),
      root,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  result.cleanedUp = !existsSync(root)
  return result
}

// the executor registry — same shape for every provider row; the phase picks ONE per batch, never mixes.
export const EXECUTOR_REGISTRY = {
  // glm row is provided by sandbox.launchAgent (wired in pilot.mjs); codex row here:
  codex: { launch: launchCodex, parse: parseCodexJsonl, buildArgv: buildCodexArgv, buildEnv: buildCodexEnv },
}
