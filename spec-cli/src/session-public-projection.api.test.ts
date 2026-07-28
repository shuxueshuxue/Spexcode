import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

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

function record(id: string, project: string, pending: unknown): Record<string, unknown> {
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
    harness: 'claude',
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

test('all public record APIs share pending projection and malformed fail-closed semantics', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-public-record-projection-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const pendingId = 'pending-public-record'
  const malformedId = 'malformed-public-record'
  let backend: ChildProcess | null = null
  let pendingProcess: ChildProcess | null = null
  let malformedProcess: ChildProcess | null = null
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
    const pendingDir = join(sessions, pendingId)
    const malformedDir = join(sessions, malformedId)
    mkdirSync(pendingDir, { recursive: true })
    mkdirSync(malformedDir, { recursive: true })
    writeFileSync(join(pendingDir, 'session.json'), JSON.stringify(record(pendingId, project, {
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
    }), null, 2) + '\n')
    writeFileSync(join(malformedDir, 'session.json'), JSON.stringify(record(malformedId, project, {
      version: 1,
      startedAt: Date.now(),
      original: { status: 'awaiting', proposal: 'merge', note: 'incomplete original' },
    }), null, 2) + '\n')

    const processEnv = (id: string): NodeJS.ProcessEnv => ({
      ...process.env,
      SPEXCODE_PROJECT_ROOT: project,
      SPEXCODE_SESSION_ID: id,
    })
    pendingProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: processEnv(pendingId) })
    malformedProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: processEnv(malformedId) })
    await waitFor(() => pendingProcess?.pid != null && malformedProcess?.pid != null, 'owned fixture processes')

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

    const [sessionsResponse, graphResponse, edgesResponse, resourcesResponse, settingsResponse] = await Promise.all([
      fetch(`${base}/api/sessions?all=1`),
      fetch(`${base}/api/graph`),
      fetch(`${base}/api/sessions/edges`),
      fetch(`${base}/api/resources`),
      fetch(`${base}/api/settings`),
    ])
    for (const response of [sessionsResponse, graphResponse, edgesResponse, resourcesResponse, settingsResponse]) {
      if (response.status !== 200) assert.fail(`${response.url} returned ${response.status}: ${await response.text()}`)
    }

    const rows = await sessionsResponse.json() as any[]
    const graph = await graphResponse.json() as { sessions: any[] }
    const edges = await edgesResponse.json() as { nodes: any[] }
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
    assertPending(rows.find((row) => row.id === pendingId), '/api/sessions')
    assertPending(graph.sessions.find((row) => row.id === pendingId), '/api/graph')
    assertPending(edges.nodes.find((row) => row.id === pendingId), '/api/sessions/edges')
    assertPending(resources.owners.find((row) => row.kind === 'session' && row.id === pendingId), '/api/resources')
    assertPending(settings.layout.worktrees.find((row) => row.session === pendingId), '/api/settings')

    const assertMalformed = (row: any, surface: string) => {
      assert.ok(row, `${surface} keeps the malformed row`)
      assert.equal(row.status, 'corrupt', `${surface} marks malformed pending as corrupt`)
      assert.equal(row.liveness, 'unknown', `${surface} fails malformed pending closed`)
      assert.notEqual(row.status, 'idle')
      assert.notEqual(row.liveness, 'online')
    }
    assertMalformed(rows.find((row) => row.id === malformedId), '/api/sessions')
    assertMalformed(graph.sessions.find((row) => row.id === malformedId), '/api/graph')
    assertMalformed(edges.nodes.find((row) => row.id === malformedId), '/api/sessions/edges')
    assertMalformed(resources.owners.find((row) => row.kind === 'session' && row.id === malformedId), '/api/resources')
    assertMalformed(settings.layout.worktrees.find((row) => row.session === malformedId), '/api/settings')
  } finally {
    await Promise.all([stopChild(backend), stopChild(pendingProcess), stopChild(malformedProcess)])
    rmSync(fixture, { recursive: true, force: true })
    assert.equal(existsSync(fixture), false)
  }
})
