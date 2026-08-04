import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeProject } from './project-store.js'
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

type Backend = { child: ChildProcess; readLog: () => string }

test('public review and merge authority bind exact head and one durable dispatch', { timeout: 180_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-manager-authority-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const [portA, portB] = await Promise.all([freePort(), freePort()])
  const tmux = `spex-manager-authority-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['opencode'],
    sessions: { launchers: { fake: { harness: 'opencode', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
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

  const backends = new Set<Backend>()
  const startBackend = (port: number): Backend => {
    const child = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    const backend = { child, readLog: capture(child) }
    backends.add(backend)
    return backend
  }
  const stopBackend = async (backend: Backend | null) => {
    if (!backend) return
    const { child } = backend
    if (child.exitCode === null) {
      try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }
      await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (child.exitCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    backends.delete(backend)
  }
  const baseA = `http://127.0.0.1:${portA}`
  const baseB = `http://127.0.0.1:${portB}`
  const waitHealth = (base: string, label: string) => waitFor(async () => {
    try { return (await request(base, '/health')).status } catch { return 0 }
  }, (status) => status === 200, label)
  let backendA: Backend | null = startBackend(portA)
  let backendB: Backend | null = startBackend(portB)
  let id = ''
  try {
    await Promise.all([waitHealth(baseA, 'backend A health'), waitHealth(baseB, 'backend B health')])
    const legacyNoBody = await request(baseA, '/api/sessions/no-such-session/merge', { method: 'POST' })
    assert.equal(legacyNoBody.status, 409, legacyNoBody.text)
    const created = await request(baseA, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-session' },
      body: JSON.stringify({ prompt: 'manager authority fixture', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, created.text)
    id = created.body.id
    assert.ok(id)
    const detail = await waitFor(
      () => request(baseA, `/api/sessions/${id}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'fixture session online',
    )
    const worktree = detail.path as string
    const sessionBranch = git(worktree, 'branch', '--show-current')
    assert.ok(worktree)
    assert.ok(sessionBranch)

    writeFileSync(join(worktree, 'value.txt'), 'review-one\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority one')
    const headOne = git(worktree, 'rev-parse', 'HEAD')
    const reviewOne = await request(baseA, `/api/sessions/${id}/review`)
    assert.equal(reviewOne.status, 200, reviewOne.text)

    writeFileSync(join(worktree, 'value.txt'), 'review-two\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority two')
    const headTwo = git(worktree, 'rev-parse', 'HEAD')
    assert.notEqual(headTwo, headOne)
    const reviewTwo = await request(baseB, `/api/sessions/${id}/review`)
    assert.equal(reviewTwo.status, 200, reviewTwo.text)

    const noKey = async (body: string) => request(baseA, `/api/sessions/${id}/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    })
    const noKeyReplies = [
      await noKey('{ not json'),
      await noKey('null'),
      await noKey(JSON.stringify({ reviewedHead: headOne, extra: true })),
    ]
    const emptyKey = await request(baseA, `/api/sessions/${id}/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': '' }, body: JSON.stringify({ reviewedHead: headTwo }),
    })
    const beforeKeyed = await request(baseA, `/api/sessions/${id}/timeline`)
    const baselinePrompts = beforeKeyed.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))

    const runtime = join(home, 'projects', encodeProject(project))
    const sessionDir = join(runtime, 'sessions', id)
    const pendingPath = join(sessionDir, 'pending.json')
    const rendezvousPath = readFileSync(join(sessionDir, 'rv.path'), 'utf8').trim()
    rmSync(rendezvousPath, { force: true })
    assert.equal(existsSync(rendezvousPath), false)
    const pendingCount = () => {
      if (!existsSync(pendingPath)) return 0
      const value = JSON.parse(readFileSync(pendingPath, 'utf8'))
      return Array.isArray(value) ? value.length : -1
    }

    const merge = (base: string, key: string, reviewedHead: string) => request(base, `/api/sessions/${id}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify({ reviewedHead }),
    })
    const concurrent = await Promise.all([
      merge(baseA, 'maintenance-release-1', headTwo),
      merge(baseB, 'maintenance-release-1', headTwo),
    ])
    const pendingAfterConcurrent = pendingCount()
    await Promise.all([stopBackend(backendA), stopBackend(backendB)])
    backendA = null
    backendB = null
    backendA = startBackend(portA)
    await waitHealth(baseA, 'restarted backend health')
    const replay = await merge(baseA, 'maintenance-release-1', headTwo)
    const pendingAfterRestartReplay = pendingCount()
    const reused = await merge(baseA, 'maintenance-release-1', headOne)
    const stale = await merge(baseA, 'maintenance-release-2', headOne)

    git(worktree, 'checkout', '--detach', '-q', headTwo)
    const detached = await merge(baseA, 'maintenance-release-detached', headTwo)
    git(worktree, 'checkout', '-q', sessionBranch)
    git(worktree, 'checkout', '-qb', 'authority-other', headTwo)
    const wrongBranch = await merge(baseA, 'maintenance-release-wrong-branch', headTwo)
    git(worktree, 'checkout', '-q', sessionBranch)
    git(worktree, 'branch', '-D', 'authority-other')

    const finalTimeline = await request(baseA, `/api/sessions/${id}/timeline`)
    const finalMergePrompts = finalTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
    const keyedPrompt = finalMergePrompts.find((event: any) => event.text.includes(headTwo))?.text ?? ''
    const observed = {
      reviewOneHead: reviewOne.body.head,
      reviewTwoHead: reviewTwo.body.head,
      noKey: noKeyReplies.map((reply) => ({ status: reply.status, body: reply.body })),
      emptyKey: { status: emptyKey.status, code: emptyKey.body.code },
      baselinePromptCount: baselinePrompts.length,
      concurrent: concurrent.map((reply) => ({ status: reply.status, dispatched: reply.body.dispatched, replayed: reply.body.replayed }))
        .sort((left, right) => Number(left.replayed) - Number(right.replayed)),
      pendingAfterConcurrent,
      replay: { status: replay.status, dispatched: replay.body.dispatched, replayed: replay.body.replayed },
      pendingAfterRestartReplay,
      reused: { status: reused.status, code: reused.body.code },
      stale: { status: stale.status, code: stale.body.code },
      detached: { status: detached.status, code: detached.body.code },
      wrongBranch: { status: wrongBranch.status, code: wrongBranch.body.code },
      finalPromptCount: finalMergePrompts.length,
      promptBindsReviewedHead: keyedPrompt.includes(headTwo),
      promptReprovesSymbolicBranch: keyedPrompt.includes('symbolic-ref --quiet --short HEAD'),
      promptReprovesStoredRef: keyedPrompt.includes(`show-ref --verify --hash 'refs/heads/${sessionBranch}'`),
      promptMergesExactObject: keyedPrompt.includes('merge --no-ff') && keyedPrompt.includes('"$candidate"'),
      rawKeyVisible: JSON.stringify(finalTimeline.body).includes('maintenance-release-1'),
    }
    console.log(`manager-authority-proof ${JSON.stringify(observed)}`)
    assert.deepEqual(observed, {
      reviewOneHead: headOne,
      reviewTwoHead: headTwo,
      noKey: [
        { status: 200, body: { dispatched: true } },
        { status: 200, body: { dispatched: true } },
        { status: 200, body: { dispatched: true } },
      ],
      emptyKey: { status: 400, code: 'session_merge_invalid_request' },
      baselinePromptCount: 3,
      concurrent: [
        { status: 200, dispatched: true, replayed: false },
        { status: 200, dispatched: true, replayed: true },
      ],
      pendingAfterConcurrent: 1,
      replay: { status: 200, dispatched: true, replayed: true },
      pendingAfterRestartReplay: 1,
      reused: { status: 409, code: 'session_merge_key_reused' },
      stale: { status: 409, code: 'session_merge_head_changed' },
      detached: { status: 409, code: 'session_merge_branch_unproven' },
      wrongBranch: { status: 409, code: 'session_merge_branch_unproven' },
      finalPromptCount: 4,
      promptBindsReviewedHead: true,
      promptReprovesSymbolicBranch: true,
      promptReprovesStoredRef: true,
      promptMergesExactObject: true,
      rawKeyVisible: false,
    })
  } finally {
    if (id && backendA) await request(baseA, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    for (const backend of [...backends]) {
      await stopBackend(backend)
      if (backend.child.exitCode && backend.child.exitCode !== 0 && backend.child.signalCode !== 'SIGTERM') console.error(backend.readLog())
    }
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* public close may already stop the private server */ }
    rmSync(fixture, { recursive: true, force: true })
  }
})
