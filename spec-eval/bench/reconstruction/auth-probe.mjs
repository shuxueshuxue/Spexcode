// spec-reconstruction-bench codex auth-binding YATU probe ([[spec-reconstruction-bench]]).
//   run: node spec-eval/bench/reconstruction/auth-probe.mjs      (exit 0 = pass)
//
// Proves — with the REAL codex 0.144.3 CLI, NO external network, NO real credential — that the frozen
// per-run config actually binds: inside `docker --network none` a loopback fake Responses endpoint
// receives the CLI's request and we assert (1) the Authorization header carries EXACTLY the dummy key
// injected via the TOML-DECLARED env_key variable, (2) the request body's model is the adapter pin
// gpt-5.5, (3) the path is the responses wire. The verdict is evidence the DECLARED auth/provider/model
// binding is what the CLI actually sends — not an assumption about auth.json side effects.
//
// Two modes in one file: host mode wraps `--inner` in the no-network container (node dist + codex pkg +
// this bench dir mounted read-only; only tmpfs writable).
import { execFileSync } from 'node:child_process'

const DUMMY_KEY = 'dummy-probe-key-0123456789abcdef'
const PORT = 18123
const HERE = new URL('.', import.meta.url).pathname
const NODE_DIST = '/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64'
const CODEX_PKG = `${NODE_DIST}/lib/node_modules/@openai/codex`
const IMAGE = 'scb-spexcode-base:0.4.0'

if (process.argv[2] === '--inner') {
  await inner()
} else {
  host()
}

function host() {
  let out = ''
  try {
    out = execFileSync('timeout', ['150', 'docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000',
      '--read-only', '--tmpfs', '/tmp:exec,uid=1000', '-e', 'HOME=/tmp/probe-home',
      '-v', `${NODE_DIST}:/opt/node:ro`, '-v', `${CODEX_PKG}:/opt/codex:ro`, '-v', `${HERE}:/work/bench:ro`,
      IMAGE, '/opt/node/bin/node', '/work/bench/auth-probe.mjs', '--inner'],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '')
  }
  const line = out.split('\n').find((l) => l.startsWith('AUTHPROBE:'))
  if (!line) { console.error('auth-probe: no verdict from container:\n' + out.slice(-800)); process.exit(1) }
  const v = JSON.parse(line.slice('AUTHPROBE:'.length))
  for (const c of v.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name} — ${c.evidence}`)
  console.log(v.pass ? '\nauth-probe ✓ CLI sends the DECLARED env_key credential to the pinned provider/model (loopback, no external network, dummy key)' : '\nauth-probe ✗ FAILED')
  process.exit(v.pass ? 0 : 1)
}

async function inner() {
  const { codexConfigToml, buildCodexArgv, buildCodexEnv, CODEX_PROVIDER } = await import('/work/bench/codex-adapter.mjs')
  const http = await import('node:http')
  const fs = await import('node:fs')
  const cp = await import('node:child_process')
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { if (body.length < 1 << 20) body += c })
    req.on('end', () => {
      let model = null
      try { model = JSON.parse(body)?.model ?? null } catch { const m = body.match(/"model"\s*:\s*"([^"]+)"/); model = m ? m[1] : null }
      requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization ?? null, model })
      // minimal Responses-wire SSE so the CLI can complete; the probe's evidence is the REQUEST either way
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end([
        'event: response.created', 'data: {"type":"response.created","response":{"id":"resp_probe"}}', '',
        'event: response.output_item.done', 'data: {"type":"response.output_item.done","item":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}', '',
        'event: response.completed', 'data: {"type":"response.completed","response":{"id":"resp_probe","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}', '',
      ].join('\n') + '\n')
    })
  })
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

  const home = '/tmp/probe-home', codexHome = '/tmp/probe-home/codex', sqliteHome = '/tmp/probe-home/sqlite'
  for (const d of [home, codexHome, sqliteHome]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(`${codexHome}/config.toml`, codexConfigToml({
    model: CODEX_PROVIDER.model, providerName: CODEX_PROVIDER.providerName,
    baseUrl: `http://127.0.0.1:${PORT}/v1`, wireApi: CODEX_PROVIDER.wireApi, envKey: 'OPENAI_API_KEY',
  }))
  const env = buildCodexEnv({ home, codexHome, sqliteHome, authEnvName: 'OPENAI_API_KEY', authValue: DUMMY_KEY,
    passthrough: { PATH: '/usr/bin:/bin:/opt/node/bin', LANG: 'C.UTF-8' } })
  const codex = cp.spawn('/opt/node/bin/node', ['/opt/codex/bin/codex.js', ...buildCodexArgv(CODEX_PROVIDER.model), 'Reply with ok'],
    { env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] })
  const t0 = Date.now()
  while (requests.length === 0 && codex.exitCode === null && Date.now() - t0 < 60_000) await new Promise((r) => setTimeout(r, 200))
  await new Promise((r) => setTimeout(r, 500))   // let a follow-up request land if one is in flight
  try { codex.kill('SIGKILL') } catch {}
  server.close()

  const first = requests[0] ?? null
  const checks = [
    { name: 'request-reached-loopback-provider', ok: requests.length >= 1, evidence: `requests=${requests.length}` },
    { name: 'authorization-is-declared-env-key-dummy', ok: first?.authorization === `Bearer ${DUMMY_KEY}`, evidence: `authorization=${first?.authorization === `Bearer ${DUMMY_KEY}` ? 'Bearer <dummy — exact match>' : JSON.stringify(first?.authorization)}` },
    { name: 'body-model-is-pin', ok: first?.model === CODEX_PROVIDER.model, evidence: `model=${first?.model}` },
    { name: 'path-is-responses-wire', ok: !!first?.path && /\/responses/.test(first.path), evidence: `path=${first?.path}` },
  ]
  process.stdout.write('AUTHPROBE:' + JSON.stringify({ pass: checks.every((c) => c.ok), checks }) + '\n')
  process.exit(0)
}
