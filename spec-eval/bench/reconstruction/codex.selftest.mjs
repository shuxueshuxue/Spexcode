// no-model isolation + fake controls for the Codex adapter ([[spec-reconstruction-bench]]).
//   run: node spec-eval/bench/reconstruction/codex.selftest.mjs   (exit 0 = pass)
// Exercises argv / env-allowlist / global-config-trap / strict parser / cleanup / secret scan WITHOUT any
// network or model call. The REAL model gate is NOT fired here (blocked on an approved endpoint/credential
// /slug); launchCodex must refuse.
import { buildCodexArgv, buildCodexEnv, codexConfigToml, parseCodexJsonl, fakeCodexAttempt, launchCodex, CODEX_ENV_ALLOW } from './codex-adapter.mjs'
import { secretScan } from './sandbox.mjs'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }

const PROVIDER = { model: 'fake-slug', providerName: 'sub2api', baseUrl: 'http://127.0.0.1:18080/v1', wireApi: 'responses', authEnvName: 'SRB_CODEX_KEY', authValue: 'FAKEKEY-abc123', responseTrace: { model: 'fake-slug', expected: 'fake-slug' } }

// argv: structured, exact, no split-string, refuses missing slug
check('argv-structured', JSON.stringify(buildCodexArgv('m')) === JSON.stringify(['exec', '--json', '--ephemeral', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'danger-full-access', '-m', 'm']))
let argvThrew = false; try { buildCodexArgv() } catch { argvThrew = true }
check('argv-refuses-missing-slug', argvThrew)

// env: explicit allowlist only + isolation vars; ambient not inherited
process.env.SRB_LEAKY_VAR = 'should-not-appear'
const env = buildCodexEnv({ home: '/t/h', codexHome: '/t/c', sqliteHome: '/t/s', authEnvName: 'SRB_CODEX_KEY', authValue: 'K', passthrough: { PATH: '/usr/bin', SRB_LEAKY_VAR: 'x' } })
check('env-no-ambient-inheritance', !('SRB_LEAKY_VAR' in env) || env.SRB_LEAKY_VAR === undefined, JSON.stringify(Object.keys(env)))
check('env-allowlist-only', Object.keys(env).every((k) => CODEX_ENV_ALLOW.includes(k) || ['HOME', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'SRB_CODEX_KEY'].includes(k)))
check('env-sets-isolation-homes', env.HOME === '/t/h' && env.CODEX_HOME === '/t/c' && env.CODEX_SQLITE_HOME === '/t/s')
delete process.env.SRB_LEAKY_VAR

// config.toml provider row shape
const toml = codexConfigToml({ model: 'm', providerName: 'sub2api', baseUrl: 'http://x', wireApi: 'responses' })
check('config-provider-row', /model = "m"/.test(toml) && /\[model_providers\.sub2api\]/.test(toml) && /wire_api = "responses"/.test(toml) && /base_url = "http:\/\/x"/.test(toml))

// parser: good stream ok; each malformed variant fails
check('parser-good', parseCodexJsonl(fakeEvents('good')).ok === true)
check('parser-dup-thread-fails', parseCodexJsonl(fakeEvents('dup-thread')).ok === false)
check('parser-missing-completed-fails', parseCodexJsonl(fakeEvents('missing-completed')).ok === false)
check('parser-turn-failed-fails', parseCodexJsonl(fakeEvents('turn-failed')).ok === false)
check('parser-error-event-fails', parseCodexJsonl(fakeEvents('error-event')).ok === false)
check('parser-bad-usage-fails', parseCodexJsonl(fakeEvents('bad-usage')).ok === false)
// usage is the terminal snapshot, not summed
const goodParsed = parseCodexJsonl(fakeEvents('good'))
check('usage-terminal-snapshot', goodParsed.tokens?.input === 100 && goodParsed.tokens?.output === 40 && goodParsed.tokens?.cached === 20)
// model unverified without a provider trace (CLI JSONL has no model id)
check('model-unverified-without-trace', parseCodexJsonl(fakeEvents('good'), {}).modelVerified === false)
check('model-verified-with-matching-trace', parseCodexJsonl(fakeEvents('good'), { providerModelTrace: { model: 'x', expected: 'x' } }).modelVerified === true)
check('model-unverified-with-mismatch-trace', parseCodexJsonl(fakeEvents('good'), { providerModelTrace: { model: 'y', expected: 'x' } }).modelVerified === false)

// full fake attempt: isolation + cleanup + secret scan
const good = fakeCodexAttempt({ slug: 'fake-slug', provider: PROVIDER, kind: 'good', scanFn: secretScan })
check('attempt-home-under-tmp', good.homeUnderTmp === true)
check('attempt-no-global-codex-touch', good.touchesGlobalCodex === false)
check('attempt-config-written', good.configHasProvider === true)
check('attempt-cleanup', good.cleanedUp === true)
check('attempt-good-parses', good.parsed.ok === true)
const leaky = fakeCodexAttempt({ slug: 'fake-slug', provider: PROVIDER, kind: 'good', secretKey: 'FAKEKEY-abc123', scanFn: secretScan })
check('attempt-secret-scan-catches-leak', leaky.secretScanResult && leaky.secretScanResult.keyHits >= 1, JSON.stringify(leaky.secretScanResult))

// REAL launch must refuse without an approved provider config, and even with one (not enabled in build)
let noProvThrew = false; try { await launchCodex({}) } catch { noProvThrew = true }
check('launchCodex-blocked-without-provider', noProvThrew)
let withProvThrew = false; try { await launchCodex({ provider: PROVIDER }) } catch { withProvThrew = true }
check('launchCodex-blocked-real-run', withProvThrew)

function fakeEvents(kind) {
  // mirror fakeCodexEvents shapes for direct parser tests
  const good = [
    { type: 'thread.started', thread_id: 'th_1' }, { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'assistant_message', text: 'ok' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 40, reasoning_output_tokens: 10 } },
  ]
  if (kind === 'good') return good
  if (kind === 'dup-thread') return [good[0], { type: 'thread.started', thread_id: 'th_2' }, ...good.slice(1)]
  if (kind === 'missing-completed') return good.slice(0, 3)
  if (kind === 'turn-failed') return [good[0], good[1], { type: 'turn.failed', error: 'boom' }]
  if (kind === 'error-event') return [good[0], { type: 'error', message: 'x' }, good[1], good[3]]
  if (kind === 'bad-usage') return [good[0], good[1], { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 99, output_tokens: 5, reasoning_output_tokens: 0 } }]
  return good
}

console.log(failed ? `\nCODEX SELFTEST FAILED (${failed})` : '\ncodex selftest ✓ all pass (no model call; real gate blocked)')
process.exit(failed ? 1 : 0)
