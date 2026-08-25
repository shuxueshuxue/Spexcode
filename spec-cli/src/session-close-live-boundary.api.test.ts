import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { initializeFreshSessionApplication } from './session-application.js'

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

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

test('public direct close removes the worktree only after the live target is cold and filed', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-live-close-boundary-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  const tmuxServer = `spex-live-close-boundary-${process.pid}-${Date.now()}`
  const id = 'live-close-boundary'
  const branch = 'node/live-close-boundary'
  const worktree = join(fixture, 'live-worktree')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const recordDir = join(runtime, 'sessions', id)
  const record = join(recordDir, 'runtime.json')
  const pidFile = join(recordDir, 'agent.pid')
  const socket = join(fixture, 'rendezvous.sock')
  const capture = join(fixture, 'filing-boundary.txt')
  const config = join(fixture, 'agent.json')
  const previousHome = process.env.SPEXCODE_HOME
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  let backend: ChildProcess | null = null
  let agentPid = 0
  try {
    process.env.SPEXCODE_HOME = home
    process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'archive@example.test')
    git(project, 'config', 'user.name', 'Archive Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ "$1" = "-C" ] && [ "$3" = "worktree" ] && [ "$4" = "prune" ]; then
  archived=0; grep -q '"archived": true' "$LIVE_RECORD" && archived=1
  cold=0; grep -q '"cold_proof": "cold-v1|' "$LIVE_RECORD" && cold=1
  pid=1; ! kill -0 "$(cat "$LIVE_PID_FILE")" 2>/dev/null && pid=0
  socket=1; test ! -e "$LIVE_SOCKET" && socket=0
  printf 'archived=%s cold=%s pid=%s socket=%s\\n' "$archived" "$cold" "$pid" "$socket" > "$LIVE_CAPTURE"
fi
exec /usr/bin/git "$@"
`)
    chmodSync(join(bin, 'git'), 0o755)
    const agentScript = join(fixture, 'agent.cjs')
    writeFileSync(agentScript, `const fs = require('node:fs')
const net = require('node:net')
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
try { fs.unlinkSync(config.socket) } catch {}
fs.writeFileSync(config.pidFile, String(process.pid) + '\\n')
net.createServer((client) => client.end()).listen(config.socket)
setInterval(() => {}, 1000)
`)
    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEX_SESSION_DATABASE_PATH: join(home, 'sessions.sqlite'),
      SPEXCODE_TMUX: tmuxServer,
      LIVE_WORKTREE: worktree,
      LIVE_RECORD: record,
      LIVE_PID_FILE: pidFile,
      LIVE_SOCKET: socket,
      LIVE_CAPTURE: capture,
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

    git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
    mkdirSync(recordDir, { recursive: true })
    writeFileSync(join(recordDir, 'rv.path'), `${socket}\n`)
    writeFileSync(record, JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch,
      node: 'archive', title: '', name: '', parent: '', status: 'idle', proposal: '', merges: 0,
      note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'claude', launch_cmd: 'claude', launch_owner: '',
    }, null, 2) + '\n')
    initializeFreshSessionApplication().createSession({ sessionId: id, status: 'idle', proposal: 'nothing' })
    writeFileSync(config, JSON.stringify({ pidFile, socket }) + '\n')
    const started = spawnSync('/usr/bin/tmux', ['-L', tmuxServer, 'new-session', '-d', '-s', id, process.execPath, agentScript, config, id], { encoding: 'utf8' })
    assert.equal(started.status, 0, started.stderr)
    await waitFor(() => existsSync(pidFile) && existsSync(socket), 'fixture agent startup')
    agentPid = Number(readFileSync(pidFile, 'utf8').trim())
    await waitFor(async () => {
      const sessions = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as Array<{ id: string; liveness: string }>
      if (!Array.isArray(sessions)) assert.fail(`unexpected sessions response: ${JSON.stringify(sessions)}\n${log}`)
      return sessions.some((session) => session.id === id && session.liveness === 'online')
    }, 'online public session projection')

    const closed = await fetch(`${base}/api/sessions/${id}/close`, { method: 'POST' })
    assert.equal(closed.status, 200)
    assert.deepEqual(await closed.json(), { ok: true })
    assert.equal(readFileSync(capture, 'utf8'), 'archived=1 cold=1 pid=0 socket=0\n')
    assert.equal(pidAlive(agentPid), false)
    assert.equal(existsSync(record), true, 'close retains the public record')
    assert.equal(JSON.parse(readFileSync(record, 'utf8')).archived, true, 'the retained record projects closed')
    assert.equal(existsSync(worktree), false)
    assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: project }).status, 0, 'close retains the branch')
    assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/spex-archive/${id}`], { cwd: project }).status, 0, 'close files the worktree tree before removal')
  } finally {
    await stopChild(backend)
    spawnSync('/usr/bin/tmux', ['-L', tmuxServer, 'kill-server'], { stdio: 'ignore' })
    if (agentPid && pidAlive(agentPid)) {
      try { process.kill(agentPid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    rmSync(fixture, { recursive: true, force: true })
  }
})
