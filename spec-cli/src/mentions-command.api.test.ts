import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = process.env.SPEX_PACKAGE_ROOT || join(here, '..')
const fakeLauncher = join(packageRoot, 'test', 'fixtures', 'fake-claude')

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

async function request(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* capture is plain text */ }
  return { status: response.status, body, text }
}

test('a Command Box @session stays in the selected session instead of prompting the reference', { timeout: 120_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-passive-mention-home-'))
  const project = mkdtempSync(join(tmpdir(), 'spex-passive-mention-project-'))
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n\nfixture project\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed'], { cwd: project })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `spex-passive-mention-${process.pid}-${Date.now()}`,
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  const base = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = capture(backend)
  const created: string[] = []
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')
    const create = async (prompt: string): Promise<string> => {
      const result = await request(base, '/api/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, launcher: 'fake' }),
      })
      assert.equal(result.status, 201, result.text)
      const id = (result.body as { id?: string }).id
      assert.ok(id, result.text)
      created.push(id)
      await waitFor(async () => (await request(base, `/api/sessions/${id}`)).body as { liveness?: string }, (session) => session.liveness === 'online', `session ${id} online`)
      return id
    }
    const source = await create('source session')
    const referenced = await create('referenced session')
    const text = `@${referenced} inspect this context`
    const result = await request(base, `/api/sessions/${source}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'command', text }),
    })
    assert.equal(result.status, 200, result.text)
    await waitFor(async () => (await request(base, `/api/sessions/${source}/capture`)).text, (pane) => pane.includes(text), 'source prompt')
    await new Promise((resolve) => setTimeout(resolve, 350))
    const targetPane = (await request(base, `/api/sessions/${referenced}/capture`)).text
    assert.ok(!targetPane.includes('@-mentioned you'), `@ must not prompt the referenced session:\n${targetPane}`)
  } finally {
    for (const id of created.reverse()) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
    if (backend.exitCode && backend.exitCode !== 0) console.error(logs())
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
