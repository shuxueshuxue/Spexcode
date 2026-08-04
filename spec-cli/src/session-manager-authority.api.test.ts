import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = process.env.SPEX_PACKAGE_ROOT || join(here, '..')
const fakeLauncher = join(packageRoot, 'test', 'fixtures', 'fake-claude')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('node:net').AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

function capture(child: ChildProcess): () => string {
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk })
  child.stderr?.on('data', (chunk) => { output += chunk })
  return () => output
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

type Reply = { status: number; body: any; text: string }
async function request(base: string, path: string, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* plain-text failure */ }
  return { status: response.status, body, text }
}

test('public review and merge authority bind exact head and one durable dispatch', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-manager-authority-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const tmux = `spex-manager-authority-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  writeFileSync(join(project, 'value.txt'), 'base\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'authority@example.test')
  git(project, 'config', 'user.name', 'Authority Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture seed')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: tmux,
    FAKE_HARNESS_INTERVAL_MS: '50',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]
  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const logs = capture(backend)
  const base = `http://127.0.0.1:${port}`
  let id = ''
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')
    const created = await request(base, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-session' },
      body: JSON.stringify({ prompt: 'manager authority fixture', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, created.text)
    id = created.body.id
    assert.ok(id)
    const detail = await waitFor(
      () => request(base, `/api/sessions/${id}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'fixture session online',
    )
    const worktree = detail.path as string
    assert.ok(worktree)

    writeFileSync(join(worktree, 'value.txt'), 'review-one\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority one')
    const headOne = git(worktree, 'rev-parse', 'HEAD')
    const reviewOne = await request(base, `/api/sessions/${id}/review`)
    assert.equal(reviewOne.status, 200, reviewOne.text)

    writeFileSync(join(worktree, 'value.txt'), 'review-two\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority two')
    const headTwo = git(worktree, 'rev-parse', 'HEAD')
    assert.notEqual(headTwo, headOne)
    const reviewTwo = await request(base, `/api/sessions/${id}/review`)
    assert.equal(reviewTwo.status, 200, reviewTwo.text)

    const merge = (key: string, reviewedHead: string) => request(base, `/api/sessions/${id}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ reviewedHead }),
    })
    const first = await merge('maintenance-release-1', headTwo)
    const replay = await merge('maintenance-release-1', headTwo)
    const afterReplay = await request(base, `/api/sessions/${id}/timeline`)
    assert.equal(afterReplay.status, 200, afterReplay.text)
    const mergePrompts = afterReplay.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
    const reused = await merge('maintenance-release-1', headOne)
    const stale = await merge('maintenance-release-2', headOne)
    const finalTimeline = await request(base, `/api/sessions/${id}/timeline`)
    const finalMergePrompts = finalTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
    assert.deepEqual({
      reviewOneHead: reviewOne.body.head,
      reviewTwoHead: reviewTwo.body.head,
      first: { status: first.status, dispatched: first.body.dispatched, replayed: first.body.replayed },
      replay: { status: replay.status, dispatched: replay.body.dispatched, replayed: replay.body.replayed },
      promptsAfterReplay: mergePrompts.length,
      reused: { status: reused.status, code: reused.body.code },
      stale: { status: stale.status, code: stale.body.code },
      finalPromptCount: finalMergePrompts.length,
      rawKeyVisible: JSON.stringify(finalTimeline.body).includes('maintenance-release-1'),
    }, {
      reviewOneHead: headOne,
      reviewTwoHead: headTwo,
      first: { status: 200, dispatched: true, replayed: false },
      replay: { status: 200, dispatched: true, replayed: true },
      promptsAfterReplay: 1,
      reused: { status: 409, code: 'session_merge_key_reused' },
      stale: { status: 409, code: 'session_merge_head_changed' },
      finalPromptCount: 1,
      rawKeyVisible: false,
    })
  } finally {
    if (id) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend.exitCode === null) {
      try { process.kill(-backend.pid!, 'SIGTERM') } catch { backend.kill('SIGTERM') }
      await Promise.race([new Promise((resolve) => backend.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (backend.exitCode === null) { try { process.kill(-backend.pid!, 'SIGKILL') } catch { backend.kill('SIGKILL') } }
    }
    if (backend.exitCode && backend.exitCode !== 0) console.error(logs())
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* public close may already stop the private server */ }
    rmSync(fixture, { recursive: true, force: true })
  }
})
