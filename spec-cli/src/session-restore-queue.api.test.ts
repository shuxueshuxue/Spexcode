import { fixtureTempDir } from '../test/fixtures/temp-dir.js'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const fakeHarness = join(here, '..', 'test', 'fixtures', 'fake-claude')

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
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

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

type SessionRow = {
  id: string
  path?: string
  branch?: string | null
  status?: string
  lifecycle?: string
  liveness?: string
  archived?: boolean
}

test('YATU: archived dirty work restores by native id and corrupt queue rows cannot block healthy work', { timeout: 180_000 }, async () => {
  const fixture = fixtureTempDir('spex-session-restore-queue-')
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const database = join(home, 'sessions.sqlite')
  const launcherLog = join(fixture, 'launcher-args.log')
  const launcher = join(fixture, 'logging-fake-claude')
  const port = await freePort()
  const tmux = `spex-restore-queue-${process.pid}-${Date.now()}`
  const configPath = join(project, '.spec', 'spexcode.json')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const recordPath = (id: string) => join(runtime, 'sessions', id, 'runtime.json')
  let backend: ChildProcess | null = null
  let log = ''
  const base = `http://127.0.0.1:${port}`
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: home,
    SPEX_SESSION_DATABASE_PATH: database,
    SPEXCODE_TMUX: tmux,
    FAKE_HARNESS_INTERVAL_MS: '120',
  }
  for (const key of ['SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]

  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n\nfixture\n')
    writeFileSync(launcher, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> ${JSON.stringify(launcherLog)}
exec ${JSON.stringify(fakeHarness)} "$@"
`)
    chmodSync(launcher, 0o755)
    writeFileSync(configPath, JSON.stringify({
      harnesses: ['claude'],
      sessions: { maxActive: 1, launchers: { fake: { harness: 'claude', cmd: launcher } }, defaultLauncher: 'fake' },
    }, null, 2) + '\n')
    writeFileSync(join(project, 'README.md'), 'base\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'restore@example.test')
    git(project, 'config', 'user.name', 'Restore Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'backend health')

    const create = async (key: string, prompt: string): Promise<SessionRow> => {
      const response = await fetch(`${base}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ prompt, launcher: 'fake' }),
      })
      const text = await response.text()
      assert.equal(response.status, 201, text)
      return JSON.parse(text) as SessionRow
    }
    const row = async (id: string): Promise<SessionRow | null> => {
      const response = await fetch(`${base}/api/sessions/${id}`)
      if (response.status === 404) return null
      const text = await response.text()
      assert.equal(response.status, 200, text)
      return JSON.parse(text) as SessionRow
    }
    const online = (id: string) => row(id).then((value) => value?.liveness === 'online').catch(() => false)

    // One real create/close/resume loop proves the archived worktree is the durable source of dirty state.
    const archived = await create('restore-archive', 'archive round trip')
    assert.ok(archived.id)
    await waitFor(() => online(archived.id), 'initial session online')
    assert.ok(archived.path)
    writeFileSync(join(archived.path!, 'README.md'), 'dirty tracked\n')
    writeFileSync(join(archived.path!, 'untracked.txt'), 'dirty untracked\n')
    const closed = await fetch(`${base}/api/sessions/${archived.id}/close`, { method: 'POST' })
    assert.equal(closed.status, 200, await closed.text())
    await waitFor(async () => {
      const value = await row(archived.id)
      return value?.lifecycle === 'archived' && value.archived === true && !existsSync(archived.path!)
    }, 'archived record and removed worktree')
    assert.match(git(project, 'rev-parse', '--verify', `refs/spex-archive/${archived.id}`), /^[0-9a-f]{40}$/)

    const resumed = await fetch(`${base}/api/sessions/${archived.id}/resume`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const resumedText = await resumed.text()
    assert.equal(resumed.status, 200, resumedText)
    const resumedRow = await row(archived.id)
    assert.equal(resumedRow?.lifecycle, 'idle', 'resume leaves the session in the work lifecycle')
    assert.equal(resumedRow?.archived, false, 'resume clears the terminal archive projection')
    await waitFor(() => online(archived.id), 'resumed session online')
    assert.equal(readFileSync(join(archived.path!, 'README.md'), 'utf8'), 'dirty tracked\n')
    assert.equal(readFileSync(join(archived.path!, 'untracked.txt'), 'utf8'), 'dirty untracked\n')
    const launchArgs = readFileSync(launcherLog, 'utf8')
    assert.match(launchArgs, new RegExp(`--session-id\\n${archived.id}`), 'initial launch pins the native id')
    assert.match(launchArgs, new RegExp(`--resume\\n${archived.id}`), 'resume reuses the same native id')

    // Simulate a backend interruption after it durably began a second resume, while the candidate leaf is
    // already alive. Recovery must adopt that exact runtime and publish the fence; it must not spawn a twin.
    const activeRecord = recordPath(archived.id)
    const activePidPath = join(dirname(activeRecord), 'agent.pid')
    await waitFor(() => existsSync(activePidPath), 'active agent identity')
    const activePid = readFileSync(activePidPath, 'utf8').trim()
    const activeRaw = JSON.parse(readFileSync(activeRecord, 'utf8')) as Record<string, any>
    activeRaw.launch_readiness_pending = {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: resumedRow?.lifecycle ?? 'idle',
        proposal: activeRaw.proposal ?? null,
        note: activeRaw.note ?? null,
        stopped: false,
        archived: false,
        closed_at: null,
        cold_proof: activeRaw.cold_proof ?? null,
        adapter_recovery: activeRaw.adapter_recovery ?? null,
      },
    }
    writeFileSync(activeRecord, JSON.stringify(activeRaw, null, 2) + '\n')
    const adopted = await fetch(`${base}/api/sessions/${archived.id}/resume`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    const adoptedText = await adopted.text()
    assert.equal(adopted.status, 200, adoptedText)
    assert.equal(readFileSync(activePidPath, 'utf8').trim(), activePid, 'pending recovery adopted the existing leaf')
    const adoptedRaw = JSON.parse(readFileSync(activeRecord, 'utf8')) as Record<string, unknown>
    assert.equal(adoptedRaw.launch_readiness_pending, '', 'successful adoption clears the durable fence')

    activeRaw.launch_readiness_pending.startedAt = Date.now()
    writeFileSync(activeRecord, JSON.stringify(activeRaw, null, 2) + '\n')
    const pendingClose = await fetch(`${base}/api/sessions/${archived.id}/close`, { method: 'POST' })
    assert.equal(pendingClose.status, 409, await pendingClose.text())
    assert.equal(readFileSync(activePidPath, 'utf8').trim(), activePid, 'close does not signal a pending restore')

    // Free the cap, then prepare two queued sessions. The first is corrupted after a real create; the second
    // must still drain once capacity grows, while the malformed bytes remain untouched and visible as unknown.
    const stopped = await fetch(`${base}/api/sessions/${archived.id}/stop`, { method: 'POST' })
    assert.equal(stopped.status, 200, await stopped.text())
    assert.equal(JSON.parse(readFileSync(activeRecord, 'utf8')).launch_readiness_pending, '', 'the existing stop cancels the pending transaction after exact teardown')
    assert.equal((await row(archived.id))?.lifecycle, 'idle', 'cancellation preserves the open canonical declaration')
    const blocker = await create('restore-blocker', 'queue blocker')
    await waitFor(() => online(blocker.id), 'queue blocker online')
    const corrupt = await create('restore-corrupt', 'corrupt queue row')
    const healthy = await create('restore-healthy', 'healthy queue row')
    await waitFor(async () => (await row(corrupt.id))?.lifecycle === 'queued', 'corrupt row queued')

    const corruptPath = recordPath(corrupt.id)
    const before = readFileSync(corruptPath, 'utf8')
    const parsed = JSON.parse(before) as Record<string, unknown>
    parsed.launch_readiness_pending = {
      version: 1,
      startedAt: Date.now(),
      original: { status: 'invalid-lifecycle', proposal: null, note: null, stopped: true, archived: false, cold_proof: null, adapter_recovery: null },
    }
    writeFileSync(corruptPath, JSON.stringify(parsed, null, 2) + '\n')
    const malformed = readFileSync(corruptPath, 'utf8')
    assert.notEqual(malformed, before)

    writeFileSync(configPath, JSON.stringify({
      harnesses: ['claude'],
      sessions: { maxActive: 3, launchers: { fake: { harness: 'claude', cmd: launcher } }, defaultLauncher: 'fake' },
    }, null, 2) + '\n')
    await waitFor(() => online(healthy.id), 'healthy queued session drains around corrupt row', 45_000)
    const corruptRow = await row(corrupt.id)
    assert.equal(corruptRow?.status, 'corrupt')
    assert.equal(corruptRow?.liveness, 'unknown')
    assert.equal(readFileSync(corruptPath, 'utf8'), malformed, 'corrupt record bytes are never rewritten')
    assert.match(log, new RegExp(`launch queue excluded ${corrupt.id}`), 'queue logs the isolated session error')
  } finally {
    if (backend) await stopChild(backend)
    spawnSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' })
    rmSync(fixture, { recursive: true, force: true })
  }
})
