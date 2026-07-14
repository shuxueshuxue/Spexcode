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

// temp CODEX_HOME/config.toml provider row (parameterized; no global config copy)
export function codexConfigToml({ model, providerName, baseUrl, wireApi = 'responses' }) {
  if (!model || !providerName || !baseUrl) throw new Error('codex config: model, providerName, baseUrl required')
  return [
    `model = "${model}"`,
    `model_provider = "${providerName}"`,
    '',
    `[model_providers.${providerName}]`,
    `name = "${providerName}"`,
    `base_url = "${baseUrl}"`,
    `wire_api = "${wireApi}"`,
    '',
  ].join('\n')
}

// STRICT parser over codex exec --json JSONL events (already parsed objects, in order).
export function parseCodexJsonl(events, { providerModelTrace = null } = {}) {
  const errors = []
  const count = (t) => events.filter((e) => e && e.type === t).length
  const nThreadStarted = count('thread.started')
  const nTurnStarted = count('turn.started')
  const nTurnCompleted = count('turn.completed')
  if (nThreadStarted !== 1) errors.push(`thread.started count=${nThreadStarted} (need exactly 1)`)
  if (nTurnStarted !== 1) errors.push(`turn.started count=${nTurnStarted} (need exactly 1)`)
  if (nTurnCompleted !== 1) errors.push(`turn.completed count=${nTurnCompleted} (need exactly 1)`)
  const threadStarted = events.find((e) => e?.type === 'thread.started')
  const threadId = threadStarted?.thread_id ?? null
  if (nThreadStarted === 1 && !threadId) errors.push('thread.started has no thread_id')
  if (count('error') > 0) errors.push(`${count('error')} error event(s)`)
  if (count('turn.failed') > 0) errors.push(`${count('turn.failed')} turn.failed event(s)`)
  // usage = the UNIQUE terminal snapshot from turn.completed (never summed across events)
  const completed = events.find((e) => e?.type === 'turn.completed')
  const u = completed?.usage ?? null
  let tokens = null
  if (u) {
    const input = u.input_tokens ?? 0, output = u.output_tokens ?? 0
    const cached = u.cached_input_tokens ?? 0, reasoning = u.reasoning_output_tokens ?? 0
    if (cached > input) errors.push(`cached_input_tokens ${cached} > input_tokens ${input}`)
    if (reasoning > output) errors.push(`reasoning_output_tokens ${reasoning} > output_tokens ${output}`)
    tokens = { input, output, cached, reasoning }
  } else if (nTurnCompleted === 1) {
    errors.push('turn.completed carries no usage snapshot')
  }
  // CLI JSONL has NO actual model id — verification REQUIRES a provider response trace matching the slug
  const modelVerified = !!providerModelTrace && !!providerModelTrace.model && providerModelTrace.model === providerModelTrace.expected
  return { ok: errors.length === 0, errors, threadId, tokens, modelVerified, providerModelTrace }
}

// REAL launch — intentionally blocked until an authorized caller supplies the approved provider config.
export async function launchCodex(opts) {
  const { provider } = opts ?? {}
  if (!provider || !provider.baseUrl || !provider.model || !(provider.authEnvName || provider.authHelper)) {
    throw new Error('launchCodex BLOCKED: no approved sub2api endpoint / credential path / model slug in repo-local state. ' +
      'Supply {provider:{baseUrl, model, providerName, authEnvName|authHelper}} from an authorized path (never ~/.codex).')
  }
  throw new Error('launchCodex: real container run not enabled in this build — awaiting manager-approved credential path + model gate')
}

// FAKE adapter for no-model tests: emits canned JSONL through the SAME isolation plumbing (temp HOME/
// CODEX_HOME, explicit env, structured argv), exercising argv/env/parser/cleanup/secret without network.
export function fakeCodexEvents(kind = 'good', { slug = 'fake-slug', secret = null } = {}) {
  const good = [
    { type: 'thread.started', thread_id: 'th_fake_001' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'assistant_message', text: secret ? `leaked ${secret}` : 'ok' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10 } },
  ]
  if (kind === 'good') return good
  if (kind === 'dup-thread') return [good[0], { type: 'thread.started', thread_id: 'th_x' }, ...good.slice(1)]
  if (kind === 'missing-completed') return good.slice(0, 3)
  if (kind === 'turn-failed') return [good[0], good[1], { type: 'turn.failed', error: 'boom' }]
  if (kind === 'error-event') return [good[0], { type: 'error', message: 'x' }, good[1], good[3]]
  if (kind === 'bad-usage') return [good[0], good[1], { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 5, reasoning_output_tokens: 0 } }]
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
    const events = fakeCodexEvents(kind, { slug, secret: secretKey })
    const jsonl = events.map((e) => JSON.stringify(e)).join('\n')
    const parsed = parseCodexJsonl(events, { providerModelTrace: provider?.responseTrace ?? null })
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
