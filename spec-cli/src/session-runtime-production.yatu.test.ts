import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// A file: URL's `pathname` is percent-ENCODED, so it is a path only while every character is ASCII-safe.
// SpexCode names a worktree after the prompt that created it, so its own dogfood checkouts routinely sit
// under non-ASCII directories — and there `pathname` hands the runtime an already-escaped string that gets
// escaped a second time, so the backend dies with ERR_MODULE_NOT_FOUND before this test can start it.
// fileURLToPath is the decode that belongs here.
const here = new URL('.', import.meta.url)
const fakeLauncher = fileURLToPath(new URL('../test/fixtures/fake-claude', here))

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 40))
  }
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return
  process.kill('SIGTERM')
  await Promise.race([once(process, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))])
  if (process.exitCode === null) process.kill('SIGKILL')
}

test('YATU: CLI-created parent/child state survives backend restart and delivers a fenced watcher notification', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-runtime-production-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const tmuxDir = join(fixture, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  mkdirSync(tmuxDir)
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }) + '\n')
  writeFileSync(join(tmuxDir, 'tmux'), '#!/bin/sh\n[ "$1" = "-V" ] && { echo "tmux 3.4"; exit 0; }\nexit 1\n')
  chmodSync(join(tmuxDir, 'tmux'), 0o755)
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'runtime@example.test')
  git(project, 'config', 'user.name', 'Runtime Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${tmuxDir}:${process.env.PATH || ''}`,
    SPEXCODE_HOME: home,
    PORT: String(port),
    SPEXCODE_TMUX: `runtime-production-${port}`,
    FAKE_HARNESS_INTERVAL_MS: '30',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  let backend: ChildProcess | null = null
  let backendLog = ''
  const start = () => spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./index.ts', import.meta.url))], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const startAndCapture = () => {
    const child = start()
    child.stdout?.on('data', chunk => { backendLog += String(chunk) })
    child.stderr?.on('data', chunk => { backendLog += String(chunk) })
    return child
  }
  const request = async (path: string, init?: RequestInit) => fetch(`${base}${path}`, init)
  try {
    backend = startAndCapture()
    await waitFor(() => request('/health').then(response => response.ok).catch(() => false), 'backend startup').catch(error => { throw new Error(`${error instanceof Error ? error.message : String(error)} (exit=${backend?.exitCode ?? 'running'})\n${backendLog}`) })
    const create = async (body: Record<string, unknown>) => {
      const response = await request('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const text = await response.text()
      assert.equal(response.status, 201, text)
      return JSON.parse(text) as { id: string; parent: string | null }
    }
    const sameKeyResponses = await Promise.all(Array.from({ length: 16 }, () => request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'runtime-same-key-create' },
      body: JSON.stringify({ prompt: 'runtime same-key create', launcher: 'fake' }),
    })))
    const sameKeyBodies = await Promise.all(sameKeyResponses.map(async response => {
      const text = await response.text()
      assert.equal(response.status, 201, text)
      return JSON.parse(text) as { id: string }
    }))
    assert.equal(new Set(sameKeyBodies.map(body => body.id)).size, 1)
    const sameKeyEvents = await request(`/api/session-runtime/${encodeURIComponent(sameKeyBodies[0].id)}/events`)
    assert.equal(sameKeyEvents.status, 200)
    assert.equal((await sameKeyEvents.json() as Array<unknown>).length, 1)
    const parent = await create({ prompt: 'runtime parent', launcher: 'fake' })
    const child = await create({ prompt: 'runtime child', parent: parent.id, launcher: 'fake' })
    assert.equal(child.parent, parent.id)
    const watch = await request(`/api/session-runtime/${encodeURIComponent(child.id)}/watch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ watcherSessionId: parent.id }),
    })
    if (watch.status !== 201) assert.fail(await watch.text())
    const state = await request(`/api/session-runtime/${encodeURIComponent(child.id)}/state`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active', reason: 'started' }),
    })
    if (state.status !== 200) assert.fail(await state.text())
    const events = await request(`/api/session-runtime/${encodeURIComponent(child.id)}/events`)
    assert.equal(events.status, 200)
    assert.equal((await events.json() as Array<{ type: string }>).at(-1)?.type, 'session.state.changed.v1')

    await stop(backend)
    backend = startAndCapture()
    await waitFor(() => request('/health').then(response => response.ok).catch(() => false), 'backend restart').catch(error => { throw new Error(`${error instanceof Error ? error.message : String(error)} (exit=${backend?.exitCode ?? 'running'})\n${backendLog}`) })
    const replay = await request(`/api/session-runtime/${encodeURIComponent(child.id)}/replay`)
    assert.equal(replay.status, 200)
    assert.equal((await replay.json() as { status: string }).status, 'active')
    const bind = async (startToken: string, expectedGeneration?: number) => request(`/api/session-runtime/${encodeURIComponent(parent.id)}/bind`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ namespace: 'spex-governed', runtimeKind: 'fixture', nativeSessionId: 'parent-native', nativeStartToken: startToken, ...(expectedGeneration === undefined ? {} : { expectedGeneration }) }),
    })
    const firstBinding = await bind('start-1')
    if (firstBinding.status !== 200) assert.fail(await firstBinding.text())
    const secondBinding = await bind('start-2', 1)
    if (secondBinding.status !== 200) assert.fail(await secondBinding.text())
    const stale = await bind('start-3', 1)
    assert.equal(stale.status, 409)
    const publish = await request(`/api/session-runtime/${encodeURIComponent(child.id)}/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'fixture.notification.v1', body: 'after-restart' }),
    })
    if (publish.status !== 201) assert.fail(await publish.text())
    const deliveredKinds: string[] = []
    for (;;) {
      const delivered = await request(`/api/session-runtime/${encodeURIComponent(parent.id)}/dequeue`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace: 'spex-governed', expectedGeneration: 2 }),
      })
      if (delivered.status !== 200) assert.fail(await delivered.text())
      const message = await delivered.json() as { kind: string } | null
      if (!message) break
      deliveredKinds.push(message.kind)
      if (message.kind === 'fixture.notification.v1') break
    }
    assert.ok(deliveredKinds.includes('fixture.notification.v1'))
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
