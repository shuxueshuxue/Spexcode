// no-model isolation + fake controls for the Codex adapter ([[spec-reconstruction-bench]]).
//   run: node spec-eval/bench/reconstruction/codex.selftest.mjs   (exit 0 = pass)
// Exercises argv / env-allowlist / global-config-trap / STRICT parser (raw lines, order, unique terminal,
// assistant output item, finite usage, malformed-line, transport-only model evidence) / cleanup / secret
// scan WITHOUT any network or model call. The REAL model gate is NOT fired (launchCodex refuses).
import { buildCodexArgv, buildCodexEnv, codexConfigToml, parseCodexJsonl, fakeCodexLines, fakeCodexAttempt, launchCodex, CODEX_ENV_ALLOW } from './codex-adapter.mjs'
import { rawByteScan } from './sandbox.mjs'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }
const P = (kind, opts) => parseCodexJsonl(fakeCodexLines(kind), opts)
const PROVIDER = { model: 'gpt-5.5', providerName: 'sub2api', baseUrl: 'http://127.0.0.1:18080/v1', wireApi: 'responses', authEnvName: 'SRB_CODEX_KEY', authValue: 'FAKEKEY-abc123' }

// argv: structured, exact, refuses missing slug
check('argv-structured', JSON.stringify(buildCodexArgv('m')) === JSON.stringify(['exec', '--json', '--ephemeral', '--ignore-rules', '--skip-git-repo-check', '--sandbox', 'danger-full-access', '-m', 'm']))
let t = false; try { buildCodexArgv() } catch { t = true } check('argv-refuses-missing-slug', t)

// env: allowlist only, no ambient inheritance
process.env.SRB_LEAKY_VAR = 'nope'
const env = buildCodexEnv({ home: '/t/h', codexHome: '/t/c', sqliteHome: '/t/s', authEnvName: 'SRB_CODEX_KEY', authValue: 'K', passthrough: { PATH: '/usr/bin', SRB_LEAKY_VAR: 'x' } })
check('env-no-ambient', !('SRB_LEAKY_VAR' in env))
check('env-allowlist-only', Object.keys(env).every((k) => CODEX_ENV_ALLOW.includes(k) || ['HOME', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'SRB_CODEX_KEY'].includes(k)))
check('env-isolation-homes', env.HOME === '/t/h' && env.CODEX_HOME === '/t/c' && env.CODEX_SQLITE_HOME === '/t/s')
delete process.env.SRB_LEAKY_VAR

// config.toml: provider row + value escaping + bare-identifier guard
check('config-provider-row', /model = "m"/.test(codexConfigToml({ model: 'm', providerName: 'sub2api', baseUrl: 'http://x' })) && /\[model_providers\.sub2api\]/.test(codexConfigToml({ model: 'm', providerName: 'sub2api', baseUrl: 'http://x' })))
check('config-escapes-quotes', /base_url = "http:\/\/x\\"evil"/.test(codexConfigToml({ model: 'm', providerName: 'p', baseUrl: 'http://x"evil' })))
let ct = false; try { codexConfigToml({ model: 'm', providerName: 'bad name', baseUrl: 'x' }) } catch { ct = true } check('config-rejects-bad-provider-name', ct)

// STRICT parser
check('parser-good', P('good').ok === true)
check('parser-malformed-line-fails', P('malformed-line').ok === false)
check('parser-out-of-order-fails', P('out-of-order').ok === false)
check('parser-dup-thread-fails', P('dup-thread').ok === false)
check('parser-missing-completed-fails', P('missing-completed').ok === false)
check('parser-no-assistant-item-fails', P('no-assistant-item').ok === false)
check('parser-turn-failed-fails', P('turn-failed').ok === false)
check('parser-error-event-fails', P('error-event').ok === false)
check('parser-bad-usage-fails', P('bad-usage').ok === false)
check('parser-noninteger-usage-fails', P('nonint-usage').ok === false)
check('usage-terminal-snapshot', P('good').tokens?.input === 100 && P('good').tokens?.output === 40 && P('good').tokens?.cached === 20)

// model evidence ONLY from the controlled transport — a caller-forged trace (wrong source) must NOT verify
check('model-unverified-without-trace', P('good').modelVerified === false)
check('model-unverified-with-forged-caller-trace', P('good', { transportModelTrace: { model: 'gpt-5.5' }, expectedModel: 'gpt-5.5' }).modelVerified === false)
check('model-verified-only-from-transport', P('good', { transportModelTrace: { source: 'controlled-http-transport', model: 'gpt-5.5' }, expectedModel: 'gpt-5.5' }).modelVerified === true)
check('model-unverified-on-slug-mismatch', P('good', { transportModelTrace: { source: 'controlled-http-transport', model: 'other' }, expectedModel: 'gpt-5.5' }).modelVerified === false)

// full fake attempt: isolation + cleanup + secret scan (raw-byte helper)
const good = fakeCodexAttempt({ slug: 'gpt-5.5', provider: PROVIDER, kind: 'good', scanFn: (blob, k) => rawByteScan(Buffer.from(blob, 'utf8'), k) })
check('attempt-home-under-tmp', good.homeUnderTmp === true)
check('attempt-no-global-codex-touch', good.touchesGlobalCodex === false)
check('attempt-config-written', good.configHasProvider === true)
check('attempt-cleanup', good.cleanedUp === true)
check('attempt-good-parses', good.parsed.ok === true)
const leaky = fakeCodexAttempt({ slug: 'gpt-5.5', provider: PROVIDER, kind: 'good', secretKey: 'FAKEKEY-abc123', scanFn: (blob, k) => rawByteScan(Buffer.from(blob, 'utf8'), k) })
check('attempt-secret-scan-catches-leak', leaky.secretScanResult && leaky.secretScanResult.keyHits >= 1, JSON.stringify(leaky.secretScanResult))

// REAL launch refuses without reviewer GO (uncalled draft)
let g1 = false; try { await launchCodex({}) } catch { g1 = true } check('launchCodex-blocked-no-go', g1)
let g2 = false; try { await launchCodex({ provider: PROVIDER }) } catch { g2 = true } check('launchCodex-blocked-without-reviewerGo', g2)

console.log(failed ? `\nCODEX SELFTEST FAILED (${failed})` : '\ncodex selftest ✓ all pass (no model call; real gate blocked)')
process.exit(failed ? 1 : 0)
