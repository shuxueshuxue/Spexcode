import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { get } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const TARGET = 'remote-auth-target'

type Run = { code: number | null; out: string; err: string }

function sessionDir(home: string, id: string): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  return join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
}

function writeTarget(home: string): string {
  const dir = sessionDir(home, TARGET)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: TARGET, governed: true, worktree_path: pkgRoot, branch: `node/${TARGET}`, node: 'remote-client',
    title: 'password-gated remote target', name: '', parent: '', status: 'active', proposal: '', merges: 0, note: '',
    sortkey: '', createdAt: Date.now(), harness: 'opencode', harness_session_id: '', stopped: false, archived: false,
    launcher: 'fixture', launch_cmd: 'true', launch_owner: '',
  }, null, 2) + '\n')
  return dir
}

function timelineText(dir: string): string {
  const legacy = join(dir, 'timeline.ndjson')
  const segments = join(dir, 'timeline')
  const files = [
    ...(existsSync(legacy) ? [legacy] : []),
    ...(existsSync(segments) ? readdirSync(segments).filter((name) => /^\d+\.ndjson$/.test(name)).sort().map((name) => join(segments, name)) : []),
  ]
  return files.map((path) => readFileSync(path, 'utf8')).join('')
}

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  server.close()
  await once(server, 'close')
  return address.port
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { err += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, out, err }
}

async function waitForGateway(port: number, log: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const ready = await new Promise<boolean>((resolve) => {
      const request = get({ hostname: '127.0.0.1', port, path: '/api/sessions', rejectUnauthorized: false }, (response) => {
        response.resume()
        resolve(response.statusCode === 401)
      })
      request.on('error', () => resolve(false))
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`public gateway did not become ready: ${log()}`)
}

async function stop(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await once(server, 'close')
}

test('credentialed remote CLI logs into a password-gated self-signed gateway and sends once', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-remote-auth-'))
  const targetDir = writeTarget(home)
  const port = await freePort()
  const password = 'gate-pass'
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(await freePort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID', 'SPEXCODE_PASSWORD']) delete env[key]
  const gateway = spawn(process.execPath, [tsxCli, cli, 'serve', '--public', '--port', String(port), '--password', password], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  gateway.stderr.setEncoding('utf8').on('data', (chunk) => { log += chunk })
  const api = `https://127.0.0.1:${port}`
  try {
    await waitForGateway(port, () => log)
    const certificate = await runCli(['session', 'ls', '--api', api, '--password', password, '--json'], env)
    assert.equal(certificate.code, 1)
    assert.match(certificate.err, /no backend reachable/)

    const missing = await runCli(['session', 'ls', '--api', api, '--insecure', '--json'], env)
    assert.equal(missing.code, 1)
    assert.match(missing.err, /authentication required/)

    const wrong = await runCli(['session', 'ls', '--api', api, '--insecure', '--password', 'wrong-pass', '--json'], env)
    assert.equal(wrong.code, 1)
    assert.match(wrong.err, /gateway login rejected credentials/)

    const sent = await runCli(['session', 'send', TARGET, 'credentialed remote message', '--api', api, '--insecure', '--password', password], env)
    assert.equal(sent.code, 0, sent.err)
    assert.equal(sent.out, 'sent\n')
    assert.match(timelineText(targetDir), /credentialed remote message/)

    const viaEnvironment = await runCli(['session', 'ls', '--api', api, '--insecure', '--json'], { ...env, SPEXCODE_PASSWORD: password })
    assert.equal(viaEnvironment.code, 0, viaEnvironment.err)
    assert.match(viaEnvironment.out, new RegExp(TARGET))
  } finally {
    await stop(gateway)
    rmSync(home, { recursive: true, force: true })
  }
})
