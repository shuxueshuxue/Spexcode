// [[manager-cockpit]] YATU: the review payload REPORTS measured loss and grades nothing — and it never
// invents numbers for a projection that does not exist yet. Boots a COLD backend of its own, reads the
// real `GET /api/sessions/:id/review` route and the real `spex session review` command before and after
// the session-eval projection becomes ready, and checks the readout against [[session-eval]]'s own summary.
//
//   node spec-cli/test/cockpit-eval-readout.mjs <session-id> [--port 8795]
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SESSION = process.argv[2] || process.env.SESSION
const PORT = Number(process.env.PORT_OVERRIDE || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8795))
if (!SESSION) { console.error('usage: node spec-cli/test/cockpit-eval-readout.mjs <session-id>'); process.exit(2) }
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const get = async (path) => {
  const response = await fetch(`${BASE}${path}`)
  return { status: response.status, body: await response.json() }
}
const cli = async (...args) => {
  const { stdout } = await run('node', [join(ROOT, 'spec-cli', 'bin', 'spex.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, SPEXCODE_API_URL: BASE },
    maxBuffer: 8 << 20,
  })
  return stdout
}

// a COLD backend: nothing has read its graph, so no session-eval projection exists for any session.
const server = spawn('npx', ['tsx', 'spec-cli/src/cli.ts', 'serve', '--port', String(PORT)], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), SPEXCODE_API_URL: undefined },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (chunk) => process.env.VERBOSE && process.stdout.write(`[serve] ${chunk}`))
server.stderr.on('data', (chunk) => process.env.VERBOSE && process.stdout.write(`[serve!] ${chunk}`))
const stop = () => { try { server.kill('SIGTERM') } catch { /* already gone */ } }
process.on('exit', stop)

for (let attempt = 0; attempt < 60; attempt++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break } catch { /* still booting */ }
  await sleep(1000)
}

try {
  console.log('\n--- COLD: the projection has never been computed')
  const cold = await get(`/api/sessions/${SESSION}/review`)
  console.log(`    gates.evals ${JSON.stringify(cold.body?.gates?.evals)}`)
  check('the review route answers', cold.status === 200 && !!cold.body?.gates)
  check('gates.evals is PRESENT and carries an explicit phase',
    typeof cold.body.gates.evals?.phase === 'string', JSON.stringify(cold.body.gates.evals))
  check('the cold phase is an honest not-ready state',
    ['unavailable', 'loading', 'updating', 'error'].includes(cold.body.gates.evals.phase), cold.body.gates.evals.phase)
  check('and it carries NO counts — not four zeros that would read as clean',
    Object.keys(cold.body.gates.evals).length === 1, JSON.stringify(cold.body.gates.evals))
  const coldCli = await cli('session', 'review', SESSION)
  console.log(coldCli.split('\n').filter((line) => /evals|gates|lint|conflicts/.test(line)).join('\n'))
  check('the CLI says the projection is not measured yet, with its phase',
    /evals\s*:\s*not measured yet \((unavailable|loading|updating|error)\)/.test(coldCli), coldCli.match(/evals.*/)?.[0])
  check('reading the review did NOT start a build', (await get(`/api/sessions/${SESSION}/review`)).body.gates.evals.phase === cold.body.gates.evals.phase)

  console.log('\n--- WARM: open the session-scoped Evals route, which is the demand path')
  const scoped = await get(`/api/evals?q=${encodeURIComponent(`is:eval scope:${SESSION}`)}&page=1`)
  check('the scoped list built the model and carries its summary', scoped.status === 200 && !!scoped.body?.summary,
    JSON.stringify(scoped.body?.summary))
  const summary = scoped.body.summary

  const warm = await get(`/api/sessions/${SESSION}/review`)
  console.log(`    gates.evals ${JSON.stringify(warm.body.gates.evals)}`)
  check('the readout is now ready', warm.body.gates.evals.phase === 'ready')
  check('and it is EXACTLY session-eval\'s four mutually exclusive categories',
    warm.body.gates.evals.freshPass === summary.pass
    && warm.body.gates.evals.freshFail === summary.fail
    && warm.body.gates.evals.needReview === summary.review
    && warm.body.gates.evals.blind === summary.blind,
    `${JSON.stringify(warm.body.gates.evals)} vs ${JSON.stringify(summary)}`)
  check('no verdict, threshold, ok flag, aggregate, or unknown-coverage rides along',
    Object.keys(warm.body.gates.evals).sort().join(',') === 'blind,freshFail,freshPass,needReview,phase',
    Object.keys(warm.body.gates.evals).join(','))
  check('the git/graph gates are untouched beside it',
    typeof warm.body.gates.conflictsWithMain === 'boolean' && typeof warm.body.gates.lint.errorCount === 'number')
  const warmCli = await cli('session', 'review', SESSION)
  console.log(warmCli.split('\n').filter((line) => /evals|gates|lint|conflicts/.test(line)).join('\n'))
  check('the CLI prints the same four facts and no verdict',
    new RegExp(`evals\\s*:\\s*${summary.pass} fresh pass, ${summary.fail} fresh fail, ${summary.review} need review, ${summary.blind} blind`).test(warmCli),
    warmCli.match(/evals.*/)?.[0])
} finally {
  stop()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
