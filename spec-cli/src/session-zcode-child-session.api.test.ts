import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
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

async function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut && child.exitCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('ZCode child identity is durable, exact, and collision-safe in the graph projection', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-zcode-child-link-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const bin = join(fixture, 'bin')
  const first = 'spex-worker-owner-a'
  const second = 'spex-worker-owner-b'
  const child = 'sess_subagent_agent_exact-child'
  let backend: ChildProcess | null = null
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['zcode'] }) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'zcode-link@example.test')
    git(project, 'config', 'user.name', 'ZCode link fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'tmux'), 0o755)

    const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const writeRecord = (id: string) => {
      const dir = join(runtime, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: project, branch: 'main',
        title: '', name: '', parent: '', status: 'idle', proposal: '', merges: 0, review_epoch: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness: 'zcode', harness_session_id: '',
        stopped: true, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'zcode', launch_cmd: 'zcode',
        launch_owner: '', create_request_id: '', create_payload_hash: '',
      }, null, 2) + '\n')
      return dir
    }
    const firstDir = writeRecord(first)
    writeRecord(second)

    const port = await freePort()
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-zcode-link-${port}`, PATH: `${bin}:${process.env.PATH || ''}` }
    delete env.SPEXCODE_API_URL
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), `backend health\n${log}`)

    const link = async (owner: string, value: unknown) => fetch(`${base}/api/sessions/${owner}/zcode-child-sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
    })
    const initialGraph = await fetch(`${base}/api/graph`)
    assert.equal(initialGraph.status, 200)
    const initialRows = (await initialGraph.json() as { sessions: Array<{ id: string; zcodeChildSessionIds?: string[] }> }).sessions
    assert.equal('zcodeChildSessionIds' in (initialRows.find((row) => row.id === first) ?? {}), false, 'the primed graph has no association before a writer declares one')
    const invalid = await link(first, {})
    assert.equal(invalid.status, 400)
    assert.deepEqual(await invalid.json(), { error: 'body needs a non-empty, whitespace-free childSessionId' })
    const whitespace = await link(first, { childSessionId: ` ${child}` })
    assert.equal(whitespace.status, 400)
    const missing = await link('no-such-spex-session', { childSessionId: child })
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'no such governed session' })
    const firstLink = await link(first, { childSessionId: child })
    assert.equal(firstLink.status, 201)
    assert.deepEqual(await firstLink.json(), { sessionId: first, childSessionId: child, alreadyLinked: false })

    let rows: Array<{ id: string; zcodeChildSessionIds?: string[] }> = []
    await waitFor(async () => {
      const graph = await fetch(`${base}/api/graph`)
      if (graph.status !== 200) return false
      rows = (await graph.json() as { sessions: Array<{ id: string; zcodeChildSessionIds?: string[] }> }).sessions
      return rows.find((row) => row.id === first)?.zcodeChildSessionIds?.includes(child) === true
    }, 'the primed graph to publish the new exact association without a backend restart')
    assert.deepEqual(rows.find((row) => row.id === first)?.zcodeChildSessionIds, [child], 'the exact owner projects its declared child id')
    assert.equal('zcodeChildSessionIds' in (rows.find((row) => row.id === second) ?? {}), false, 'absence stays absent, never an empty or zero-valued association')

    const repeat = await link(first, { childSessionId: child })
    assert.equal(repeat.status, 200)
    assert.deepEqual(await repeat.json(), { sessionId: first, childSessionId: child, alreadyLinked: true }, 'the exact pair is idempotent')

    const conflict = await link(second, { childSessionId: child })
    assert.equal(conflict.status, 409)
    assert.match(String((await conflict.json()).error), new RegExp(`${child}.*${first}`), 'a child cannot silently change SpexCode owner')
    const graphAfterConflict = await fetch(`${base}/api/graph`).then((response) => response.json()) as { sessions: Array<{ id: string; zcodeChildSessionIds?: string[] }> }
    assert.deepEqual(graphAfterConflict.sessions.find((row) => row.id === first)?.zcodeChildSessionIds, [child], 'a rejected collision leaves the original owner intact')
    assert.equal('zcodeChildSessionIds' in (graphAfterConflict.sessions.find((row) => row.id === second) ?? {}), false)

    rmSync(firstDir, { recursive: true, force: true })
    const rebound = await link(second, { childSessionId: child })
    assert.equal(rebound.status, 201)
    assert.deepEqual(await rebound.json(), { sessionId: second, childSessionId: child, alreadyLinked: false }, 'removing the owner record invalidates its association and permits a later exact link')
  } finally {
    await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
