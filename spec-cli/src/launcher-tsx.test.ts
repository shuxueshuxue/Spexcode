import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

// @@@ cross-platform tsx resolution ([[platform-support]]) - the launcher must run tsx's JS entry through
// `node` (process.execPath), NEVER spawn the `.bin/tsx` shim. On Windows that shim is an extensionless sh
// script child_process.spawn can't execute — the #37 `spawn …\.bin\tsx ENOENT` crash of `spex init`.
const SRC = dirname(fileURLToPath(import.meta.url))
const LAUNCHER = join(SRC, '..', 'bin', 'spex.mjs')
const ROOT = join(SRC, '..', '..')

test('the launcher actually runs a CLI command through node + tsx', () => {
  // an offline read-only command: proves the resolve-then-spawn path launches the TypeScript CLI end to end.
  const out = execFileSync(process.execPath, [LAUNCHER, 'help'], { encoding: 'utf8' })
  assert.match(out, /SpexCode CLI/)
})

test('the launcher spawns process.execPath against a resolved tsx JS entry, not the .bin shim', () => {
  const src = readFileSync(LAUNCHER, 'utf8')
  // spawns through THIS node binary…
  assert.match(src, /spawn\(process\.execPath,/)
  // …resolving tsx's JS entry (dist/cli.mjs) via Node's own resolver…
  assert.match(src, /resolve\('tsx\/package\.json'\)/)
  assert.match(src, /dist',\s*'cli\.mjs'/)
  // …and never reaches for the platform-specific `.bin/tsx` shim.
  assert.doesNotMatch(src, /'\.bin'/)
})

test('serve and dashboard scrub session identity before tsx can spawn its helper', () => {
  const src = readFileSync(LAUNCHER, 'utf8')
  assert.match(src, /args\[0\] === 'serve'/)
  assert.match(src, /args\[0\] === 'dashboard'/)
  assert.match(src, /SPEXCODE_SESSION_IDENTITY_VARS/)
  assert.match(src, /delete env\[key\]/)
  assert.match(src, /spawn\(process\.execPath,[\s\S]*\{ stdio: 'inherit', env \}/)
})

test('canonical npm run api crosses the scrub boundary before the tsx process tree starts', {
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
    const deadline = Date.now() + 20_000
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
    const tsx = rows.find((row) => descendants.has(row.pid) && row.args.includes('tsx/dist/cli.mjs'))
    assert.ok(tsx, 'canonical package script did not route through bin/spex.mjs into the resolved tsx entry')
    const controlPlane = new Set<number>([tsx.pid])
    for (let changed = true; changed;) {
      changed = false
      for (const row of rows) if (!controlPlane.has(row.pid) && controlPlane.has(row.ppid)) { controlPlane.add(row.pid); changed = true }
    }
    for (const pid of controlPlane) {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0')
      assert.ok(!env.some((entry) => entry.startsWith('SPEXCODE_SESSION_ID=') || entry.startsWith('CODEX_THREAD_ID=')), `PID ${pid} inherited session identity after the launcher boundary`)
    }
  } finally {
    if (child.exitCode === null) {
      try { process.kill(-child.pid!, 'SIGTERM') } catch { /* already exited */ }
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3000))])
      if (child.exitCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already exited */ } }
    }
    rmSync(home, { recursive: true, force: true })
  }
})
