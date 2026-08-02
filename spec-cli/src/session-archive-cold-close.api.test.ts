import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

function processAlive(child: ChildProcess): boolean {
  if (!child.pid) return false
  try { process.kill(child.pid, 0); return true } catch { return false }
}

test('public HTTP and CLI cold close ignore only proven-unrelated PID reuse', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-public-cold-close-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  let backend: ChildProcess | null = null
  let unrelated: ChildProcess | null = null
  let owned: ChildProcess | null = null
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'archive@example.test')
    git(project, 'config', 'user.name', 'Archive Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'tmux'), 0o755)

    const sessions = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const closeLedger = join(home, 'projects', project.replace(/[/.]/g, '-'), 'session-close-ledger.ndjson')
    const writeColdRecord = (id: string, pid: number) => {
      const dir = join(sessions, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: join(fixture, `${id}-absent`), branch: '',
        node: 'archive', title: '', name: '', parent: '', status: 'awaiting', proposal: '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
        stopped: true, archived: true, cold_proof: `cold-v1|claude|${id}|no-resident-ref`,
        adapter_recovery: '', launcher: 'claude', launch_cmd: 'claude', launch_owner: '',
      }, null, 2) + '\n')
      writeFileSync(join(dir, 'agent.pid'), `${pid}\n`)
      return join(dir, 'session.json')
    }

    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: `spex-public-cold-close-${port}`,
    }
    delete env.SPEXCODE_API_URL
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), `backend health\n${log}`)

    const reusedId = 'cold-close-reused-public'
    unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    assert.ok(unrelated.pid)
    const reusedRecord = writeColdRecord(reusedId, unrelated.pid)
    const closed = await fetch(`${base}/api/sessions/${reusedId}/close`, { method: 'POST' })
    assert.equal(closed.status, 200)
    assert.deepEqual(await closed.json(), { ok: true })
    assert.equal(existsSync(reusedRecord), false)
    assert.equal(processAlive(unrelated), true, 'HTTP cold close never signals the unrelated PID')
    let closeEvents = readFileSync(closeLedger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(closeEvents.length, 1)
    assert.equal(closeEvents[0]?.action, 'close-authorized')
    assert.deepEqual(closeEvents[0]?.source, { kind: 'user' }, 'an HTTP/dashboard close identifies its human source')
    assert.equal(closeEvents[0]?.target?.id, reusedId)

    const cliId = 'cold-close-cli-public'
    const cliRecord = writeColdRecord(cliId, unrelated.pid)
    const cliSuccess = spawnSync(process.execPath, [
      join(here, '..', 'bin', 'spex.mjs'), 'session', 'close', cliId, '--api', base,
    ], { cwd: project, env: { ...env, SPEXCODE_SESSION_ID: 'closing-cli-session' }, encoding: 'utf8' })
    assert.equal(cliSuccess.status, 0, `${cliSuccess.stdout}\n${cliSuccess.stderr}`)
    assert.equal(existsSync(cliRecord), false)
    assert.equal(processAlive(unrelated), true, 'CLI cold close never signals the unrelated PID')
    closeEvents = readFileSync(closeLedger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(closeEvents.length, 2)
    assert.deepEqual(closeEvents[1]?.source, { kind: 'session', id: 'closing-cli-session' },
      'a governed CLI close identifies its initiating session after the target record is gone')
    assert.equal(closeEvents[1]?.target?.id, cliId)

    const ownedId = 'cold-close-owned-public'
    owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ownedId], { stdio: 'ignore' })
    assert.ok(owned.pid)
    const ownedRecord = writeColdRecord(ownedId, owned.pid)
    const cli = spawnSync(process.execPath, [
      join(here, '..', 'bin', 'spex.mjs'), 'session', 'close', ownedId, '--api', base,
    ], { cwd: project, env, encoding: 'utf8' })
    assert.notEqual(cli.status, 0)
    assert.match(`${cli.stdout}\n${cli.stderr}`, /target leaf PID .* live or recycled/u)
    assert.equal(existsSync(ownedRecord), true)
    assert.equal(processAlive(owned), true, 'CLI refusal never signals the owned PID')
    assert.equal(readFileSync(closeLedger, 'utf8').trim().split('\n').length, closeEvents.length,
      'a refused live close does not create a terminal-close audit event')
  } finally {
    await stopChild(backend)
    await stopChild(unrelated)
    await stopChild(owned)
    rmSync(fixture, { recursive: true, force: true })
  }
})
