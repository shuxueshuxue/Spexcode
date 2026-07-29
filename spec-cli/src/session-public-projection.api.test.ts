import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const LIVE_PROJECT_SESSIONS = '/home/jeffry/.spexcode/projects/-home-jeffry-spexcode/sessions'

function liveSessionsCensus(): { ids: string[]; hash: string } {
  const ids = existsSync(LIVE_PROJECT_SESSIONS)
    ? readdirSync(LIVE_PROJECT_SESSIONS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : []
  return { ids, hash: createHash('sha256').update(ids.join('\0')).digest('hex') }
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
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

function record(id: string, project: string, pending: unknown, harness = 'claude'): Record<string, unknown> {
  return {
    session_id: id,
    governed: true,
    worktree_path: project,
    branch: 'main',
    node: null,
    title: null,
    name: null,
    parent: null,
    status: 'idle',
    proposal: '',
    merges: 0,
    note: 'candidate note must stay internal',
    sortkey: null,
    createdAt: Date.now(),
    harness,
    harness_session_id: '',
    stopped: false,
    archived: false,
    cold_proof: '',
    adapter_recovery: '',
    launcher: 'fixture',
    launch_cmd: 'true',
    launch_owner: '',
    launch_readiness_pending: pending,
  }
}

test('all public record APIs share pending projection and malformed fail-closed semantics', { timeout: 30_000 }, async (t) => {
  const liveBefore = liveSessionsCensus()
  const fixture = mkdtempSync(join(tmpdir(), 'spex-public-record-projection-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const pendingId = 'pending-public-record'
  const livePendingId = 'live-pending-public-record'
  const incompleteId = 'incomplete-pending-public-record'
  const invalidLifecycleId = 'invalid-lifecycle-pending-public-record'
  const invalidProposalId = 'invalid-proposal-pending-public-record'
  let backend: ChildProcess | null = null
  let pendingProcess: ChildProcess | null = null
  let livePendingProcess: ChildProcess | null = null
  let incompleteProcess: ChildProcess | null = null
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
      harnesses: ['claude'],
      resources: { sampleMs: 50, reportIntervalMs: 60_000 },
    }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'projection@example.test')
    git(project, 'config', 'user.name', 'Projection Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    const sessions = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const writeRecord = (id: string, value: Record<string, unknown>) => {
      const dir = join(sessions, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), JSON.stringify(value, null, 2) + '\n')
    }
    writeRecord(pendingId, record(pendingId, project, {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: 'awaiting',
        proposal: 'merge',
        note: 'frozen original note',
        stopped: true,
        archived: false,
        cold_proof: null,
        adapter_recovery: null,
      },
    }))
    writeRecord(livePendingId, record(livePendingId, project, {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: 'active',
        proposal: '',
        note: 'live frozen original note',
        stopped: false,
        archived: false,
        cold_proof: null,
        adapter_recovery: null,
      },
    }, 'claude-headless'))
    writeRecord(incompleteId, record(incompleteId, project, {
      version: 1,
      startedAt: Date.now(),
      original: { status: 'awaiting', proposal: 'merge', note: 'incomplete original' },
    }))
    writeRecord(invalidLifecycleId, record(invalidLifecycleId, project, {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: 'launching', proposal: 'merge', note: 'invalid lifecycle', stopped: true, archived: false,
        cold_proof: null, adapter_recovery: null,
      },
    }))
    writeRecord(invalidProposalId, record(invalidProposalId, project, {
      version: 1,
      startedAt: Date.now(),
      original: {
        status: 'awaiting', proposal: 'deploy', note: 'invalid proposal', stopped: true, archived: false,
        cold_proof: null, adapter_recovery: null,
      },
    }))

    const processEnv = (id: string): NodeJS.ProcessEnv => ({
      ...process.env,
      SPEXCODE_PROJECT_ROOT: project,
      SPEXCODE_SESSION_ID: id,
    })
    pendingProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: processEnv(pendingId) })
    livePendingProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: processEnv(livePendingId) })
    incompleteProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: processEnv(incompleteId) })
    await waitFor(() => pendingProcess?.pid != null && livePendingProcess?.pid != null && incompleteProcess?.pid != null,
      'owned fixture processes')

    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    const tmux = join(bin, 'tmux')
    writeFileSync(tmux, '#!/bin/sh\nexit 1\n')
    chmodSync(tmux, 0o755)
    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: `spex-public-record-${port}`,
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

    const refusedClose = await fetch(`${base}/api/sessions/00000000-0000-0000-0000-000000000000/close`, { method: 'POST' })
    assert.equal(refusedClose.status, 404)
    assert.deepEqual(await refusedClose.json(), {
      ok: false,
      error: 'no close transition was committed for session 00000000-0000-0000-0000-000000000000',
    })

    const [sessionsResponse, graphResponse, resourcesResponse, settingsResponse] = await Promise.all([
      fetch(`${base}/api/sessions?all=1`),
      fetch(`${base}/api/graph`),
      fetch(`${base}/api/resources`),
      fetch(`${base}/api/settings`),
    ])
    for (const response of [sessionsResponse, graphResponse, resourcesResponse, settingsResponse]) {
      if (response.status !== 200) assert.fail(`${response.url} returned ${response.status}: ${await response.text()}`)
    }

    const rows = await sessionsResponse.json() as any[]
    const graph = await graphResponse.json() as { sessions: any[] }
    const resources = await resourcesResponse.json() as { owners: any[] }
    const settings = await settingsResponse.json() as { layout: { worktrees: any[] } }
    const assertPending = (row: any, surface: string) => {
      assert.ok(row, `${surface} keeps the pending row`)
      assert.equal(row.lifecycle ?? row.status, 'awaiting', `${surface} uses the frozen lifecycle`)
      if ('proposal' in row) assert.equal(row.proposal, 'merge', `${surface} uses the frozen proposal`)
      if ('note' in row) assert.equal(row.note, 'frozen original note', `${surface} uses the frozen note`)
      if ('stopped' in row) assert.equal(row.stopped, true, `${surface} remains stopped`)
      if ('archived' in row) assert.equal(row.archived, false, `${surface} uses the frozen archive bit`)
      if ('liveness' in row) assert.equal(row.liveness, 'offline', `${surface} is offline while pending`)
      assert.notEqual(row.status, 'idle', `${surface} never exposes the candidate idle lifecycle`)
      assert.notEqual(row.liveness, 'online', `${surface} never exposes candidate online liveness`)
    }
    await t.test('valid stopped pending records stay frozen and offline on every surface', () => {
      assertPending(rows.find((row) => row.id === pendingId), '/api/sessions')
      assertPending(graph.sessions.find((row) => row.id === pendingId), '/api/graph')
      assertPending(resources.owners.find((row) => row.kind === 'session' && row.id === pendingId), '/api/resources')
      assertPending(settings.layout.worktrees.find((row) => row.session === pendingId), '/api/settings')
    })

    const assertLivePending = (row: any, surface: string) => {
      assert.ok(row, `${surface} keeps the live pending row`)
      assert.equal(row.lifecycle ?? row.status, 'active', `${surface} uses the frozen active lifecycle`)
      if ('lifecycle' in row) assert.equal(row.status, 'offline', `${surface} pins compact display offline`)
      if ('proposal' in row) assert.equal(row.proposal, null, `${surface} uses the frozen proposal`)
      if ('note' in row) assert.equal(row.note, 'live frozen original note', `${surface} uses the frozen note`)
      if ('stopped' in row) assert.equal(row.stopped, false, `${surface} preserves the frozen stopped bit`)
      if ('archived' in row) assert.equal(row.archived, false, `${surface} preserves the frozen archive bit`)
      assert.equal(row.liveness, 'offline', `${surface} stays offline despite the live candidate process`)
      assert.notEqual(row.status, 'working', `${surface} never reconciles the candidate into working`)
      assert.notEqual(row.status, 'idle', `${surface} never exposes the candidate idle lifecycle`)
    }
    await t.test('a live candidate cannot change the frozen display or offline liveness', () => {
      assertLivePending(rows.find((row) => row.id === livePendingId), '/api/sessions live candidate')
      assertLivePending(graph.sessions.find((row) => row.id === livePendingId), '/api/graph live candidate')
      assertLivePending(resources.owners.find((row) => row.kind === 'session' && row.id === livePendingId), '/api/resources live candidate')
      assertLivePending(settings.layout.worktrees.find((row) => row.session === livePendingId), '/api/settings live candidate')
    })

    const assertMalformed = (row: any, surface: string) => {
      assert.ok(row, `${surface} keeps the malformed row`)
      assert.equal(row.status, 'corrupt', `${surface} marks malformed pending as corrupt`)
      assert.equal(row.liveness, 'unknown', `${surface} fails malformed pending closed`)
      assert.notEqual(row.status, 'idle')
      assert.notEqual(row.liveness, 'online')
    }
    for (const [id, label] of [
      [incompleteId, 'structurally incomplete'],
      [invalidLifecycleId, 'invalid lifecycle'],
      [invalidProposalId, 'invalid proposal'],
    ] as const) {
      await t.test(`${label} pending records are corrupt and unknown on every surface`, () => {
        assertMalformed(rows.find((row) => row.id === id), `/api/sessions ${label}`)
        assertMalformed(graph.sessions.find((row) => row.id === id), `/api/graph ${label}`)
        assertMalformed(resources.owners.find((row) => row.kind === 'session' && row.id === id), `/api/resources ${label}`)
        assertMalformed(settings.layout.worktrees.find((row) => row.session === id), `/api/settings ${label}`)
      })
    }
  } finally {
    await Promise.all([stopChild(backend), stopChild(pendingProcess), stopChild(livePendingProcess), stopChild(incompleteProcess)])
    rmSync(fixture, { recursive: true, force: true })
    assert.equal(existsSync(fixture), false)
    assert.deepEqual(liveSessionsCensus(), liveBefore, 'isolated public projection fixture leaves the live project store unchanged')
  }
})
