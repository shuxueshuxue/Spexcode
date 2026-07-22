import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

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

test('session new ordinary launcher create posts the closed API shape and succeeds', async () => {
  let posted: unknown = null
  const server = createServer((req, res) => {
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
  assert.equal(JSON.parse(stdout).id, 'created-1')
})
