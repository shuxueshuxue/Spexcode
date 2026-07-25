import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const runner = join(packageRoot, 'test', 'session-record-integrity-fixture.ts')
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
    try { if ((await fetch(`${url}/health`)).status === 200) return } catch { /* still booting */ }
    if (Date.now() >= deadline) throw new Error(`backend did not become healthy\n${logs()}`)
    if (child.exitCode !== null) throw new Error(`backend exited before health (${child.exitCode})\n${logs()}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('a note carrying quote/backslash/newline/unicode survives every real declaration entry', { timeout: 180_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-record-integrity-home-'))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'spex-record-integrity-project-')))
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  // the REAL starter tree `spex init` plants — including `.plugins/core`, so the fixture's worktrees
  // materialize the actual lifecycle hooks (mark-active among them) rather than an empty manifest.
  mkdirSync(join(project, '.spec'), { recursive: true })
  cpSync(join(packageRoot, 'templates', 'spec', 'project'), join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed'], { cwd: project })

  const tmux = `spex-record-integrity-${process.pid}-${Date.now()}`
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '80' }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID

  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const backendLogs = capture(backend)
  const base = `http://127.0.0.1:${port}`
  try {
    await waitHealth(base, backend, backendLogs)
    const runnerProcess = spawn(process.execPath, [tsxBin(packageRoot), runner], {
      cwd: project, env: { ...env, BASE: base, LAUNCHER: 'fake' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const runnerLogs = capture(runnerProcess)
    await new Promise((resolve) => runnerProcess.once('close', resolve))
    assert.equal(runnerProcess.exitCode, 0, `record-integrity fixture failed\n${runnerLogs()}\nbackend:\n${backendLogs()}`)
    assert.match(runnerLogs(), /PASS: session record integrity/)
  } finally {
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* no server to reap */ }
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
  }
})
