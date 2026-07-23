import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const repo = join(packageRoot, '..')
const runner = join(packageRoot, 'test', 'session-terminal-fixture.ts')
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

async function waitHealth(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      const response = await fetch(`${url}/health`)
      if (response.status === 200) return
    } catch { /* supervisor still booting */ }
    if (Date.now() >= deadline) throw new Error(`backend did not become healthy\n${logs()}`)
    if (child.exitCode !== null) throw new Error(`backend exited before health (${child.exitCode})\n${logs()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('external fake harness proves the managed terminal lifecycle without a model', { timeout: 120_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-fake-terminal-home-'))
  const project = mkdtempSync(join(tmpdir(), 'spex-fake-terminal-project-'))
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: {
      launchers: { fake: { harness: 'claude', cmd: fakeLauncher } },
      defaultLauncher: 'fake',
    },
  }, null, 2) + '\n')
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n\nfixture project\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed'], { cwd: project })
  const tmux = `spex-fake-terminal-${process.pid}-${Date.now()}`
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: tmux,
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID

  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const backendLogs = capture(backend)
  const base = `http://127.0.0.1:${port}`
  try {
    await waitHealth(base, backend, () => '')
    const runnerProcess = spawn(process.execPath, [tsxBin(packageRoot), runner], {
      cwd: project, env: { ...env, BASE: base, LAUNCHER: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const runnerLogs = capture(runnerProcess)
    await new Promise((resolve) => runnerProcess.once('close', resolve))
    assert.equal(runnerProcess.exitCode, 0, `fixture runner failed\n${runnerLogs()}\nbackend:\n${backendLogs()}`)
    assert.match(runnerLogs(), /PASS: POST \/api\/sessions -> online -> 101 -> PTY output -> close/)
  } finally {
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
  }
})
