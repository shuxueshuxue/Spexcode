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
  try { body = JSON.parse(text) } catch { /* plain-text response */ }
  return { status: response.status, body, text }
}

test('merge dispatch gives the agent the short local landing flow', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-merge-dispatch-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const tmux = `spex-merge-dispatch-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['opencode'],
    sessions: { launchers: { fake: { harness: 'opencode', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'merge-dispatch@example.test')
  git(project, 'config', 'user.name', 'Merge Dispatch Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture seed')

  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '100000' }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]

  const base = `http://127.0.0.1:${port}`
  let backend: ChildProcess | null = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(packageRoot, 'src', 'index.ts')], {
    cwd: project, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const stopBackend = async () => {
    if (!backend) return
    const child = backend
    backend = null
    if (child.exitCode === null) {
      try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }
      await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (child.exitCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
  }

  let id = ''
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')

    const created = await request(base, '/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'merge-dispatch-session' },
      body: JSON.stringify({ prompt: 'merge dispatch fixture', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, created.text)
    id = created.body.id
    const detail = await waitFor(
      () => request(base, `/api/sessions/${id}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'fixture session online',
    )
    const worktree = detail.path as string

    const beforeProposal = await request(base, `/api/sessions/${id}/merge`, { method: 'POST' })
    assert.deepEqual({ status: beforeProposal.status, code: beforeProposal.body.code }, { status: 409, code: 'session_merge_not_proposed' })

    execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge', '--note', 'ready to land',
    ], { cwd: worktree, env: { ...env, SPEXCODE_SESSION_ID: id }, encoding: 'utf8' })

    const cli = execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'merge', id,
    ], { cwd: project, env: { ...env, SPEXCODE_API_URL: base }, encoding: 'utf8' })
    assert.match(cli, new RegExp(`merge dispatched to ${id}`))

    const timeline = await waitFor(
      () => request(base, `/api/sessions/${id}/timeline`).then((reply) => reply.body.events as Array<{ kind: string; text: string }>),
      (events) => events.some((event) => event.kind === 'sent' && event.text.startsWith('Merge your branch into main')),
      'merge prompt timeline append',
    )
    const prompt = timeline.find((event) => event.kind === 'sent' && event.text.startsWith('Merge your branch into main'))!.text
    assert.match(prompt, /In your own worktree, merge the latest main into your branch\. Resolve any conflicts there and re-run the proof\./)
    assert.match(prompt, /Atomic landing: main only receives the completed branch as one no-ff merge\. Never resolve conflicts in the shared main checkout\./)
    assert.match(prompt, /Verify main advanced cleanly with no merge left in progress\./)
    assert.doesNotMatch(prompt, /REVIEWED_GENERATION|LANDING_MERGED|printf|expectedBranchHead|reviewEpoch/)
  } finally {
    if (id && backend) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    await stopBackend()
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* fixture server is already gone */ }
    rmSync(fixture, { recursive: true, force: true })
  }
})
