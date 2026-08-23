import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { processStartToken } from '@spexcode/spec-core'
import { cliEntrypointArgs, serverEntrypointArgs } from './tsx-bin.js'

// @@@ compiled release launcher ([[release-launcher]]) - the launcher runs its own emitted JavaScript through
// Node, never a TypeScript loader or a shell shim. This keeps installed commands independent of build tools.
const SRC = dirname(fileURLToPath(import.meta.url))
const LAUNCHER = join(SRC, '..', 'bin', 'spex.mjs')
const ROOT = join(SRC, '..', '..')

test('the launcher actually runs a compiled CLI command through node', () => {
  // An offline read-only command proves the release launcher starts the emitted CLI end to end.
  const out = execFileSync(process.execPath, [LAUNCHER, 'help'], { encoding: 'utf8' })
  assert.match(out, /SpexCode CLI/)
})

test('a source workspace launcher builds its missing runtime closure before it invokes it', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-launcher-'))
  const launcher = join(root, 'spec-cli', 'bin', 'spex.mjs')
  try {
    mkdirSync(join(root, 'spec-cli', 'bin'), { recursive: true })
    mkdirSync(join(root, 'spec-cli', 'src'), { recursive: true })
    copyFileSync(LAUNCHER, launcher)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }))
    writeFileSync(join(root, 'build.mjs'), `
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const outputs = [
  'spec-cli/dist/cli.js',
  'packages/spec-core/dist/index.js',
  'packages/session-core/dist/index.js',
  'spec-eval/dist/index.js',
  'spec-forge/dist/index.js',
]
for (const output of outputs) {
  const path = join(process.cwd(), output)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, output === 'spec-cli/dist/cli.js' ? 'console.log("compiled source workspace")\\n' : 'export {}\\n')
}
`)

    const out = execFileSync(process.execPath, [launcher, 'help'], { cwd: root, encoding: 'utf8' })
    assert.match(out, /compiled source workspace/)
    assert.ok(existsSync(join(root, 'spec-cli', 'dist', 'cli.js')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent source launchers single-flight the workspace build', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-launcher-race-'))
  const launcher = join(root, 'spec-cli', 'bin', 'spex.mjs')
  try {
    mkdirSync(join(root, 'spec-cli', 'bin'), { recursive: true })
    mkdirSync(join(root, 'spec-cli', 'src'), { recursive: true })
    copyFileSync(LAUNCHER, launcher)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }))
    writeFileSync(join(root, 'build.mjs'), `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const root = process.cwd()
appendFileSync(join(root, 'build-count'), 'build\\n')
await new Promise(resolve => setTimeout(resolve, 150))
for (const output of ['spec-cli/dist/cli.js', 'packages/spec-core/dist/index.js', 'packages/session-core/dist/index.js', 'spec-eval/dist/index.js', 'spec-forge/dist/index.js']) {
  const path = join(root, output)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, output.endsWith('/cli.js') ? 'console.log("compiled source workspace")\\n' : 'export {}\\n')
}
`)
    const launch = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [launcher, 'help'], { cwd: root, stdio: 'ignore' })
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`launcher exited ${code}`)))
    })
    await Promise.all([launch(), launch()])
    assert.equal(readFileSync(join(root, 'build-count'), 'utf8').trim(), 'build', 'concurrent launchers must share one build')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the launcher spawns process.execPath against its compiled CLI, not a TypeScript loader', () => {
  const src = readFileSync(LAUNCHER, 'utf8')
  assert.match(src, /spawn\(process\.execPath,/)
  assert.match(src, /dist',\s*'cli\.js'/)
  assert.doesNotMatch(src, /tsx\/package\.json|cli\.ts/)
  assert.doesNotMatch(src, /'\.bin'/)
})

test('source callers keep their development loader while compiled callers stay on dist', () => {
  const packageRoot = join(SRC, '..')
  assert.deepEqual(cliEntrypointArgs(packageRoot, SRC).slice(0, 1), ['--import'])
  assert.deepEqual(serverEntrypointArgs(packageRoot, SRC).slice(0, 1), ['--import'])
  assert.equal(cliEntrypointArgs(packageRoot, SRC).at(-1), join(SRC, 'cli.ts'))
  assert.equal(serverEntrypointArgs(packageRoot, SRC).at(-1), join(SRC, 'index.ts'))
  assert.deepEqual(cliEntrypointArgs(packageRoot, join(packageRoot, 'dist')), [join(packageRoot, 'dist', 'cli.js')])
  assert.deepEqual(serverEntrypointArgs(packageRoot, join(packageRoot, 'dist')), [join(packageRoot, 'dist', 'index.js')])
})

test('serve and dashboard scrub session identity before the compiled CLI starts', () => {
  const src = readFileSync(LAUNCHER, 'utf8')
  assert.match(src, /args\[0\] === 'serve'/)
  assert.match(src, /args\[0\] === 'dashboard'/)
  assert.match(src, /SPEXCODE_SESSION_IDENTITY_VARS/)
  assert.match(src, /delete env\[key\]/)
  assert.match(src, /spawn\(process\.execPath,[\s\S]*\{ stdio: 'inherit', env \}/)
})

test('canonical npm run api crosses the scrub boundary before the compiled CLI process tree starts', {
  skip: process.platform !== 'linux' ? 'process-tree environment proof reads Linux /proc' : false,
}, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-api-scrub-'))
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
  const child = spawn('npm', ['run', 'api'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_SESSION_ID: 'must-not-reach-control-plane',
      CODEX_THREAD_ID: 'must-not-reach-control-plane',
      SPEXCODE_SESSION_IDENTITY_VARS: 'SPEXCODE_SESSION_ID,CODEX_THREAD_ID',
    },
  })
  const output: Buffer[] = []
  child.stdout?.on('data', (chunk) => output.push(chunk))
  child.stderr?.on('data', (chunk) => output.push(chunk))
  try {
    const deadline = Date.now() + 45_000
    let healthy = false
    while (Date.now() < deadline) {
      try { healthy = (await fetch(`http://127.0.0.1:${port}/health`)).status === 200 } catch { /* still booting */ }
      if (healthy) break
      if (child.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(healthy, true, `npm run api did not become healthy:\n${Buffer.concat(output).toString('utf8')}`)

    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).trim().split('\n').map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), args: match[3] } : null
    }).filter((row): row is { pid: number; ppid: number; args: string } => !!row)
    const descendants = new Set<number>([child.pid!])
    for (let changed = true; changed;) {
      changed = false
      for (const row of rows) if (!descendants.has(row.pid) && descendants.has(row.ppid)) { descendants.add(row.pid); changed = true }
    }
    const cli = rows.find((row) => descendants.has(row.pid) && row.args.includes('/spec-cli/dist/cli.js'))
    assert.ok(cli, 'canonical package script did not route through bin/spex.mjs into the compiled CLI entry')
    const controlPlane = new Set<number>([cli.pid])
    for (let changed = true; changed;) {
      changed = false
      for (const row of rows) if (!controlPlane.has(row.pid) && controlPlane.has(row.ppid)) { controlPlane.add(row.pid); changed = true }
    }
    for (const pid of controlPlane) {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
      assert.ok(!env.some((entry) => entry.startsWith('SPEXCODE_SESSION_ID=') || entry.startsWith('CODEX_THREAD_ID=')), `PID ${pid} inherited session identity after the launcher boundary`)
    }
  } finally {
    // Detached gives this fixture one process group. Signal that group even when health assertion fails before
    // the descendant scan, otherwise a slow first build leaks an entire test backend into later cases.
    const signalGroup = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal) } catch { /* already gone */ } }
    signalGroup('SIGTERM')
    if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))])
    for (let i = 0; i < 30 && processStartToken(child.pid!) !== null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    signalGroup('SIGKILL')
    for (let i = 0; i < 20 && processStartToken(child.pid!) !== null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(processStartToken(child.pid!), null, 'canonical npm api fixture leaves no process group leader alive')
    rmSync(home, { recursive: true, force: true })
  }
})
