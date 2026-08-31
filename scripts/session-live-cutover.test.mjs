import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// `pathname` is percent-encoded; a checkout under a non-ASCII path (SpexCode names worktrees after their
// prompt) would hand every join below an escaped string that no longer names a directory.
const repo = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const runner = join(repo, 'scripts/session-live-cutover.mjs')
const healthyServer = `
  import { createServer } from 'node:http'
  const port = Number(process.env.FAKE_PORT)
  const server = createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); return }
    if (req.url === '/api/sessions?all=1') { res.writeHead(200, {'content-type': 'application/json'}); res.end('[]'); return }
    res.writeHead(404); res.end()
  })
  server.listen(port, '127.0.0.1')
  process.on('SIGTERM', () => { server.closeAllConnections?.(); server.close(() => process.exit(0)) })
`
const unhealthyServer = `
  import { createServer } from 'node:http'
  const port = Number(process.env.FAKE_PORT)
  const server = createServer((req, res) => { res.writeHead(500); res.end('broken') })
  server.listen(port, '127.0.0.1')
  process.on('SIGTERM', () => { server.closeAllConnections?.(); server.close(() => process.exit(0)) })
`

function command(source) {
  return [process.execPath, '--input-type=module', '-e', source]
}

async function waitHealth(port, expected = 200) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.status === expected) return
    } catch { /* process is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`fake server did not reach HTTP ${expected}`)
}

function seed(root) {
  const recordsRoot = join(root, 'sessions')
  mkdirSync(join(recordsRoot, 'parent'), { recursive: true })
  writeFileSync(join(recordsRoot, 'parent', 'session.json'), JSON.stringify({ session_id: 'parent', status: 'idle' }) + '\n')
  return recordsRoot
}

function plan(root, port, oldPid, newCommand, extra = {}) {
  return {
    serverPid: oldPid,
    port,
    oldCommand: command(healthyServer),
    newCommand,
    recordsRoot: join(root, 'sessions'),
    databasePath: join(root, 'sessions.sqlite'),
    runRoot: join(root, 'cutover-runs'),
    cwd: repo,
    env: { FAKE_PORT: String(port) },
    timeoutMs: 1_500,
    ...extra,
  }
}

async function startOld(port) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', healthyServer], {
    cwd: repo,
    env: { ...process.env, FAKE_PORT: String(port) },
    stdio: 'ignore',
  })
  await waitHealth(port)
  return child
}

test('live cutover passes an explicit orphan parent policy to the importer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-live-cutover-orphan-'))
  const port = 39_900 + Math.floor(Math.random() * 100)
  try {
    const recordsRoot = join(root, 'sessions')
    mkdirSync(join(recordsRoot, 'child'), { recursive: true })
    writeFileSync(join(recordsRoot, 'child', 'session.json'), JSON.stringify({ session_id: 'child', status: 'queued', parent: 'retired-parent' }) + '\n')
    const old = await startOld(port)
    const planPath = join(root, 'plan.json')
    writeFileSync(planPath, JSON.stringify(plan(root, port, old.pid, command(healthyServer), { orphanParentPolicy: 'tombstone' })) + '\n')
    const output = execFileSync(process.execPath, [runner, '--plan', planPath], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    const report = JSON.parse(output)
    assert.equal(report.status, 'success')
    assert.deepEqual(report.migration.orphanParents, ['retired-parent'])
    assert.equal(report.migration.records, 1)
    process.kill(report.newPid, 'SIGTERM')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('live cutover stops the named server, migrates, starts new server, and records success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-live-cutover-success-'))
  const port = 39_000 + Math.floor(Math.random() * 500)
  try {
    seed(root)
    const old = await startOld(port)
    const planPath = join(root, 'plan.json')
    writeFileSync(planPath, JSON.stringify(plan(root, port, old.pid, command(healthyServer))) + '\n')
    const output = execFileSync(process.execPath, [runner, '--plan', planPath], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    const report = JSON.parse(output)
    assert.equal(report.status, 'success')
    assert.equal(report.migration.records, 1)
    assert.equal(report.newHealth.sessionCount, 0)
    assert.equal(JSON.parse(readFileSync(join(root, 'sessions.sqlite.json-migration.json'), 'utf8')).records, 1)
    process.kill(report.newPid, 'SIGTERM')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('failed new smoke quarantines new artifacts and restarts the named old server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-live-cutover-rollback-'))
  const port = 39_500 + Math.floor(Math.random() * 400)
  try {
    seed(root)
    const old = await startOld(port)
    const planPath = join(root, 'plan.json')
    writeFileSync(planPath, JSON.stringify(plan(root, port, old.pid, command(unhealthyServer))) + '\n')
    let error
    try { execFileSync(process.execPath, [runner, '--plan', planPath], { cwd: repo, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (caught) { error = caught }
    assert(error)
    const report = JSON.parse(error.stderr)
    assert.equal(report.status, 'failed')
    assert.match(report.quarantine, /failed-/)
    assert.equal(report.rollback.sessionCount, 0)
    assert.equal(report.migration.records, 1)
    process.kill(report.rollback.oldPid, 'SIGTERM')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
