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
import { fileURLToPath, pathToFileURL } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const gateway = fileURLToPath(new URL('./gateway.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const TARGET = 'remote-auth-target'
const PEER_ANCHOR = '00000000-0000-4000-8000-000000000001'

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

async function timelineText(dir: string, home: string): Promise<string> {
  const legacy = join(dir, 'timeline.ndjson')
  const segments = join(dir, 'timeline')
  const files = [
    ...(existsSync(legacy) ? [legacy] : []),
    ...(existsSync(segments) ? readdirSync(segments).filter((name) => /^\d+\.ndjson$/.test(name)).sort().map((name) => join(segments, name)) : []),
  ]
  if (files.length) return files.map((path) => readFileSync(path, 'utf8')).join('')
  const { openProjectSessionApplication } = await import('@spexcode/session-application')
  const application = openProjectSessionApplication({ databasePath: join(home, 'sessions.sqlite'), locality: () => {} })
  try { return application.readMessageHistory(TARGET).map((message) => Buffer.from(message.body).toString('utf8')).join('\n') }
  finally { application.close() }
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

async function waitFor(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

async function stop(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await once(server, 'close')
}

function selfSigned(dir: string): { cert: string; key: string } {
  const cert = join(dir, 'gateway.cert.pem'), key = join(dir, 'gateway.key.pem')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  return { cert, key }
}

function startPasswordGateway(port: number, upstream: number, distDir: string, tls: { cert: string; key: string }, password: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
  const source = `import { readFileSync } from 'node:fs'; import { startGateway } from ${JSON.stringify(pathToFileURL(gateway).href)}; startGateway({ host: '127.0.0.1', publicPort: ${port}, upstreamPort: ${upstream}, password: ${JSON.stringify(password)}, tls: { cert: readFileSync(${JSON.stringify(tls.cert)}, 'utf8'), key: readFileSync(${JSON.stringify(tls.key)}, 'utf8') }, distDir: ${JSON.stringify(distDir)} });`
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

test('credentialed remote CLI logs into a password-gated self-signed gateway and sends once', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-remote-auth-'))
  const targetDir = writeTarget(home)
  const { migrateJsonSessionRecords } = await import('@spexcode/session-application')
  migrateJsonSessionRecords({
    databasePath: join(home, 'sessions.sqlite'),
    recordsRoot: dirname(targetDir),
    locality: () => {},
  })
  const port = await freePort()
  const upstream = await freePort()
  const password = 'gate-pass'
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'), SPEXCODE_API_URL: '', PORT: String(await freePort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID', 'SPEXCODE_PASSWORD']) delete env[key]
  const backend = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(upstream)], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  backend.stderr.setEncoding('utf8').on('data', (chunk) => { log += chunk })
  const distDir = join(home, 'dashboard')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>fixture gateway</title>')
  const tls = selfSigned(home)
  const gatewayProcess = startPasswordGateway(port, upstream, distDir, tls, password, env)
  gatewayProcess.stderr!.setEncoding('utf8').on('data', (chunk) => { log += chunk })
  const api = `https://127.0.0.1:${port}`
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${upstream}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)
    await waitForGateway(port, () => log)
    const certificate = await runCli(['session', 'ls', '--api', api, '--password', password, '--json'], env)
    assert.equal(certificate.code, 1)
    assert.match(certificate.err, /no backend reachable/)
    assert.doesNotMatch(certificate.err, /unknown flag/)

    const missing = await runCli(['session', 'ls', '--api', api, '--insecure', '--json'], env)
    assert.equal(missing.code, 1)
    assert.match(missing.err, /authentication required/)
    assert.doesNotMatch(missing.err, /unknown flag/)

    const wrong = await runCli(['session', 'ls', '--api', api, '--insecure', '--password', 'wrong-pass', '--json'], env)
    assert.equal(wrong.code, 1)
    assert.match(wrong.err, /gateway login rejected credentials/)
    assert.doesNotMatch(wrong.err, /unknown flag/)

    const listed = await runCli(['session', 'ls', '--api', api, '--insecure', '--password', password, '--json'], env)
    assert.equal(listed.code, 0, listed.err)
    assert.match(listed.out, new RegExp(TARGET))

    const resources = await runCli(['session', 'resources', '--api', api, '--insecure', '--password', password, '--json'], env)
    assert.equal(resources.code, 0, resources.err)
    assert.match(resources.out, /"owners"/)

    const sent = await runCli(['session', 'send', TARGET, 'credentialed remote message', '--api', api, '--insecure', '--password', password], env)
    assert.equal(sent.code, 0, sent.err)
    assert.equal(sent.out, 'sent\n')
    assert.match(await timelineText(targetDir, home), /credentialed remote message/)

    const viaEnvironment = await runCli(['session', 'ls', '--api', api, '--insecure', '--json'], { ...env, SPEXCODE_PASSWORD: password })
    assert.equal(viaEnvironment.code, 0, viaEnvironment.err)
    assert.match(viaEnvironment.out, new RegExp(TARGET))

    for (const verb of ['files', 'web']) {
      for (const routeFlag of [['--api', api], ['--port', String(upstream)], ['--password', password], ['--insecure']]) {
        const local = await runCli(['session', verb, 'ls', ...routeFlag], env)
        assert.equal(local.code, 2)
        assert.match(local.err, new RegExp(`spex session ${verb}: unknown flag ${routeFlag[0]}`))
      }
    }

    for (const credential of [['--password', password], ['--insecure']]) {
      const peer = await runCli(['session', 'ls', '--ssh', 'fixture-peer', PEER_ANCHOR, ...credential], env)
      assert.equal(peer.code, 2)
      assert.match(peer.err, /--password and --insecure apply only to an explicit --api route, not --ssh/)
    }
  } finally {
    await stop(gatewayProcess)
    await stop(backend)
    rmSync(home, { recursive: true, force: true })
  }
})
