import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')

async function runCreate(project: string, env: NodeJS.ProcessEnv, api: string) {
  const child = spawn(process.execPath, [tsxCli, cli, 'session', 'new', 'probe', '--api', api], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  return { code, stdout, stderr }
}

test('session new rejects stale mode flags through the generic unknown-flag path', () => {
  for (const args of [['--mode', 'headless'], ['--headless']]) {
    const flag = args[0]
    const r = spawnSync('tsx', [cli, 'session', 'new', 'probe', ...args], { cwd: pkgRoot, encoding: 'utf8' })
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, `spex session new: unknown flag ${flag}\n`)
  }
})

test('session new retires the out-of-band --node binding before launch', () => {
  const r = spawnSync('tsx', [cli, 'session', 'new', 'probe', '--node', 'launch'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'spex session new: --node was removed — put a [[<id>]] mention in the prompt — the first mention binds\n')
})

test('session new keeps exact JSON stdout and emits the dependency receipt on stderr', async () => {
  let posted: unknown = null
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/settings') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      posted = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'created-1' }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const env = { ...process.env }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  env.SPEXCODE_API_URL = ''

  const child = spawn('tsx', [cli, 'session', 'new', '[[launch]] ordinary task', '--launcher', 'claude', '--api', `http://127.0.0.1:${address.port}`], {
    cwd: pkgRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number]
  server.close()
  await once(server, 'close')

  assert.equal(code, 0, stderr)
  assert.deepEqual(posted, { prompt: '[[launch]] ordinary task', parent: null, launcher: 'claude' })
  assert.equal(stdout, '{\n  "id": "created-1"\n}\n')
  assert.equal(stderr, `spex: launched session created-1
  current result: the session JSON is on stdout now; \`spex session ls created-1\` is the later one-shot snapshot
  next lifecycle change: background \`spex session wait created-1\` (edge-triggered; exits on the next non-actionable→actionable transition); \`spex session watch created-1\` streams and NEVER EXITS
  response channel: \`spex session send created-1 "<msg>"\`; \`send --keys\` is an UNSTABLE LAST RESORT after a plain send cannot land
`)
  assert.doesNotMatch(stdout, /current result|next lifecycle change|response channel/)
})

test('session new falls back only for explicit connection refusal', { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-create-dispatch-'))
  const projectPath = join(root, 'project'); mkdirSync(projectPath)
  const project = realpathSync(projectPath), home = join(root, 'home'), bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, 'tmux'), 0o755)
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-dispatch', '-c', 'user.email=create@example.test', 'commit', '-qm', 'fixture'], { cwd: project })

  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  mkdirSync(runtime, { recursive: true })
  const { processStartToken } = await import('./process-identity.js')
  const startToken = processStartToken(process.pid); assert.ok(startToken)
  writeFileSync(join(runtime, 'session-maintenance.json'), JSON.stringify({
    version: 1,
    state: 'active',
    epoch: 1,
    tokenHash: createHash('sha256').update('dispatch-fixture').digest('hex'),
    owner: { instanceId: 'dispatch-fixture', pid: process.pid, startToken },
    heartbeatDeadline: Date.now() + 60_000,
    capabilities: [],
    tickets: [],
  }))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `create-dispatch-${process.pid}`,
    SPEXCODE_API_URL: '',
  }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const noArtifacts = () => {
    assert.equal(execFileSync('git', ['branch', '--list', 'node/*'], { cwd: project, encoding: 'utf8' }).trim(), '')
    assert.equal(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: project, encoding: 'utf8' }).match(/^worktree /gm)?.length, 1)
    assert.ok(!existsSync(join(runtime, 'sessions')) || readdirSync(join(runtime, 'sessions')).length === 0)
  }

  try {
    for (const status of [404, 503]) {
      const server = createServer((_req, res) => { res.writeHead(status); res.end('owned failure') })
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const address = server.address(); assert.ok(address && typeof address === 'object')
      const result = await runCreate(project, env, `http://127.0.0.1:${address.port}`)
      server.close(); await once(server, 'close')
      assert.equal(result.code, 1)
      assert.match(result.stderr, new RegExp(`backend rejected session \\(${status}\\)`))
      assert.doesNotMatch(result.stderr, /launching in-process|maintenance_active/)
      noArtifacts()
    }

    const slow = createServer(() => { /* accepted connection deliberately never answers */ })
    slow.listen(0, '127.0.0.1'); await once(slow, 'listening')
    const slowAddress = slow.address(); assert.ok(slowAddress && typeof slowAddress === 'object')
    const started = Date.now()
    const indeterminate = await runCreate(project, env, `http://127.0.0.1:${slowAddress.port}`)
    slow.closeAllConnections(); slow.close(); await once(slow, 'close')
    assert.equal(indeterminate.code, 1)
    assert.match(indeterminate.stderr, /backend availability is indeterminate/)
    assert.doesNotMatch(indeterminate.stderr, /launching in-process|maintenance_active/)
    assert.ok(Date.now() - started < 4_000)
    noArtifacts()

    const absent = createServer()
    absent.listen(0, '127.0.0.1'); await once(absent, 'listening')
    const absentAddress = absent.address(); assert.ok(absentAddress && typeof absentAddress === 'object')
    const refusedPort = absentAddress.port
    absent.close(); await once(absent, 'close')
    const refused = await runCreate(project, env, `http://127.0.0.1:${refusedPort}`)
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /no backend reachable .* launching in-process/)
    assert.match(refused.stderr, /maintenance_active/)
    noArtifacts()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
