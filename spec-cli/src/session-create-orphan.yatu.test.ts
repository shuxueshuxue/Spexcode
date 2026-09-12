import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = new URL('.', import.meta.url)
const cli = fileURLToPath(new URL('./cli.ts', here))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
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

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd, env: { ...env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += String(chunk) })
  child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += String(chunk) })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

test('YATU: @parent:none creates a depth-zero row and no managed watch', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-session-orphan-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const tmuxDir = join(fixture, 'bin')
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  mkdirSync(tmuxDir)
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
  writeFileSync(join(project, '.spec', 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }) + '\n')
  writeFileSync(join(tmuxDir, 'tmux'), '#!/bin/sh\n[ "$1" = "-V" ] && { echo "tmux 3.4"; exit 0; }\nexit 1\n')
  chmodSync(join(tmuxDir, 'tmux'), 0o755)
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'orphan@example.test')
  git(project, 'config', 'user.name', 'Orphan Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${tmuxDir}:${process.env.PATH || ''}`,
    SPEXCODE_HOME: home,
    PORT: String(port),
    SPEXCODE_TMUX: `session-orphan-${port}`,
    FAKE_HARNESS_INTERVAL_MS: '30',
    SPEXCODE_API_URL: '',
  }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID', 'ZCODE_SESSION_ID']) delete env[key]
  let backend: ChildProcess | null = null
  try {
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./index.ts', here))], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitFor(() => fetch(`${base}/health`).then(response => response.ok).catch(() => false), 'backend startup')

    const parentResult = await runCli(['session', 'new', 'parent lane', '--launcher', 'fake', '--api', base], project, env)
    assert.equal(parentResult.code, 0, parentResult.stderr)
    const parent = JSON.parse(parentResult.stdout) as { id: string }

    const orphanEnv = { ...env, SPEXCODE_SESSION_ID: parent.id }
    const orphanResult = await runCli(['session', 'new', '@parent:none top-level lane', '--launcher', 'fake', '--api', base], project, orphanEnv)
    assert.equal(orphanResult.code, 0, orphanResult.stderr)
    const orphan = JSON.parse(orphanResult.stdout) as { id: string; parent: string | null }
    assert.equal(orphan.parent, null)

    const listed = await runCli(['session', 'ls', orphan.id, '--api', base], project, orphanEnv)
    assert.equal(listed.code, 0, listed.stderr)
    const plainList = listed.stdout.replaceAll(String.fromCharCode(27), '').replace(/\[[0-9;]*m/g, '')
    assert.match(plainList, new RegExp(`${orphan.id.slice(0, 8)}\\s+-\\s+0\\s`), plainList)

    const watches = await runCli(['session', 'watch', 'list'], project, orphanEnv)
    assert.equal(watches.code, 0, watches.stderr)
    assert.equal(watches.stdout, '', 'the creator has no managed watch for an explicitly top-level create')
    assert.doesNotMatch(watches.stderr, new RegExp(orphan.id))
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
