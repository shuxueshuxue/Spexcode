import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const ID = 'cache-fallback-1111-1111-1111-111111111111'

async function refusedPort(): Promise<number> {
  const child = createServer()
  child.listen(0, '127.0.0.1')
  await once(child, 'listening')
  const address = child.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  child.close()
  await once(child, 'close')
  return port
}

function writeCachedSession(home: string): void {
  const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: pkgRoot, encoding: 'utf8' }).trim()
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify({
    session_id: ID, governed: true, worktree_path: worktree, branch: 'main', node: 'remote-client', title: 'cached read', name: '', parent: null,
    status: 'awaiting', proposal: 'nothing', merges: 0, note: 'durable cache', sortkey: null, createdAt: Date.now(), harness: 'claude',
    harness_session_id: '', stopped: false, archived: false, launcher: 'fixture', launch_cmd: 'true',
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'prompt'), 'read local session cache\n')
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

test('cache reads use the local store with unknown liveness only when no backend is reachable', { timeout: 30_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-client-cache-'))
  const port = await refusedPort()
  writeCachedSession(home)
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(port) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  try {
    const ls = await runCli(['session', 'ls', '--json'], env)
    assert.equal(ls.code, 0, ls.stderr)
    assert.match(ls.stdout, new RegExp(`"id": "${ID}"`))
    assert.match(ls.stdout, /"liveness": "unknown"/)
    assert.match(ls.stderr, /source: local session store \(liveness unknown\)/)

    const show = await runCli(['session', 'show', ID, '--json'], env)
    assert.equal(show.code, 0, show.stderr)
    assert.match(show.stdout, /"liveness": "unknown"/)
    assert.match(show.stdout, /"prompt": "read local session cache\\n"/)
    assert.match(show.stderr, /source: local session store \(liveness unknown\)/)

    const review = await runCli(['session', 'review', ID, '--json'], env)
    assert.equal(review.code, 0, review.stderr)
    assert.match(review.stdout, new RegExp(`"id": "${ID}"`))
    assert.match(review.stderr, /source: local session store \(liveness unknown\)/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('explicit remote routing stays loud when its port is unreachable', { timeout: 15_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-client-cache-'))
  writeCachedSession(home)
  try {
    const result = await runCli(['session', 'ls', '--json', '--api', `http://127.0.0.1:${await refusedPort()}`], { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '' })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /no backend reachable/)
    assert.doesNotMatch(result.stderr, /source: local session store/)
    assert.equal(result.stdout, '')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a backend HTTP 500 is not replaced by the local cache', { timeout: 15_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-client-cache-'))
  writeCachedSession(home)
  const server = createServer((_req, res) => { res.writeHead(500); res.end('broken backend') })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try {
    const result = await runCli(['session', 'ls', '--json'], { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: `http://127.0.0.1:${address.port}` })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /backend error 500 listing sessions/)
    assert.doesNotMatch(result.stderr, /source: local session store/)
    assert.equal(result.stdout, '')
  } finally {
    server.close()
    await once(server, 'close')
    rmSync(home, { recursive: true, force: true })
  }
})
