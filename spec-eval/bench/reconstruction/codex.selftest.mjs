// no-model isolation + fake controls for the Codex adapter ([[spec-reconstruction-bench]]).
//   run: node spec-eval/bench/reconstruction/codex.selftest.mjs   (exit 0 = pass)
// Exercises argv / env-allowlist / global-config-trap / STRICT PURE parser (raw lines, order, unique
// terminal, strict non-empty agent_message, integer usage) / the transport seam (verifyTransportTrace,
// pin = sub2api/gpt-5.5, no caller evidence path EXISTS) / cleanup / secret scan — WITHOUT any network
// or model call. The REAL launch refuses without reviewer GO.
import { buildCodexArgv, buildCodexEnv, codexConfigToml, parseCodexJsonl, verifyTransportTrace, fakeCodexLines, fakeTransportTrace, fakeCodexAttempt, launchCodex, CODEX_ENV_ALLOW, CODEX_PROVIDER } from './codex-adapter.mjs'
import { rawByteScan } from './sandbox.mjs'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }
const P = (kind) => parseCodexJsonl(fakeCodexLines(kind))

// pin is frozen and exactly the approved row
check('pin-frozen', Object.isFrozen(CODEX_PROVIDER) && CODEX_PROVIDER.providerName === 'sub2api' && CODEX_PROVIDER.model === 'gpt-5.5' && CODEX_PROVIDER.wireApi === 'responses')

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

// STRICT PURE parser — no model fields, no evidence parameters
check('parser-good', P('good').ok === true)
check('parser-has-no-model-field', !('modelVerified' in P('good')) && !('providerModelTrace' in P('good')))
check('parser-ignores-caller-evidence-arg', !('modelVerified' in parseCodexJsonl(fakeCodexLines('good'), { transportModelTrace: { model: 'gpt-5.5' } })))
check('parser-malformed-line-fails', P('malformed-line').ok === false)
check('parser-out-of-order-fails', P('out-of-order').ok === false)
check('parser-dup-thread-fails', P('dup-thread').ok === false)
check('parser-missing-completed-fails', P('missing-completed').ok === false)
check('parser-no-assistant-item-fails', P('no-assistant-item').ok === false)
check('parser-user-message-rejected', P('user-message-item').ok === false)
check('parser-empty-agent-message-rejected', P('empty-agent-message').ok === false)
check('parser-turn-failed-fails', P('turn-failed').ok === false)
check('parser-error-event-fails', P('error-event').ok === false)
check('parser-bad-usage-fails', P('bad-usage').ok === false)
check('parser-noninteger-usage-fails', P('nonint-usage').ok === false)
check('usage-terminal-snapshot', P('good').tokens?.input === 100 && P('good').tokens?.output === 40 && P('good').tokens?.cached === 20)
check('parser-captures-output', P('good').output?.length === 1 && P('good').output[0] === 'ok')

// transport seam: pin-anchored, no expected-model parameter to forge
check('transport-good-verifies', verifyTransportTrace(fakeTransportTrace('good')).verified === true)
check('transport-wrong-model-rejected', verifyTransportTrace(fakeTransportTrace('wrong-model')).verified === false)
check('transport-no-model-rejected', verifyTransportTrace(fakeTransportTrace('no-model')).verified === false)
check('transport-empty-rejected', verifyTransportTrace(fakeTransportTrace('empty')).verified === false)
check('transport-non2xx-rejected', verifyTransportTrace(fakeTransportTrace('non-2xx')).verified === false)

// full fake attempt: isolation + cleanup + secret scan + transport verdict through the SAME seam
const scan = (blob, k) => rawByteScan(Buffer.from(blob, 'utf8'), k)
const good = fakeCodexAttempt({ kind: 'good', transportKind: 'good', authEnvName: 'SRB_CODEX_KEY', authValue: 'FAKEKEY-abc123', scanFn: scan })
check('attempt-home-under-tmp', good.homeUnderTmp === true)
check('attempt-no-global-codex-touch', good.touchesGlobalCodex === false)
check('attempt-config-written', good.configHasProvider === true)
check('attempt-cleanup', good.cleanedUp === true)
check('attempt-good-parses', good.parsed.ok === true)
check('attempt-model-verified-via-seam', good.modelVerified === true)
const badTransport = fakeCodexAttempt({ kind: 'good', transportKind: 'wrong-model' })
check('attempt-wrong-transport-model-unverified', badTransport.parsed.ok === true && badTransport.modelVerified === false)
const leaky = fakeCodexAttempt({ kind: 'good', secretKey: 'FAKEKEY-abc123', scanFn: scan })
check('attempt-secret-scan-catches-leak', leaky.secretScanResult && leaky.secretScanResult.keyHits >= 1, JSON.stringify(leaky.secretScanResult))

// REAL launch refuses without reviewer GO, and the pin cannot be overridden by a caller
let g1 = false; try { await launchCodex({}) } catch { g1 = true } check('launchCodex-blocked-no-go', g1)
let g2 = false; try { await launchCodex({ provider: { model: 'gpt-5.5', providerName: 'sub2api' } }) } catch { g2 = true } check('launchCodex-blocked-without-reviewerGo', g2)

console.log(failed ? `\nCODEX SELFTEST FAILED (${failed})` : '\ncodex selftest ✓ all pass (no model call; real gate blocked)')
process.exit(failed ? 1 : 0)
