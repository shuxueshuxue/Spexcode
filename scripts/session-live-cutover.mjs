#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { migrateJsonSessionRecords, jsonMigrationFencePath } from '@spexcode/session-application'
import { requireLocalDatabasePath } from '@spexcode/session-selflaunch'

const HELP = `Usage: node scripts/session-live-cutover.mjs --plan ABSOLUTE_JSON

The plan must contain:
  serverPid, port, oldCommand[], newCommand[], recordsRoot, databasePath, runRoot
  optional: backupRoot, cwd, env, timeoutMs

The runner stops only serverPid, migrates once, starts newCommand, and checks /health
and /api/sessions?all=1. On failure it quarantines new artifacts and restarts oldCommand.`

const now = () => new Date().toISOString().replace(/[:.]/g, '-')
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function fail(message) {
  throw new Error(`session live cutover: ${message}`)
}

function readPlan() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }
  if (args.length !== 2 || args[0] !== '--plan') fail('expected exactly --plan ABSOLUTE_JSON')
  const path = args[1]
  if (!isAbsolute(path)) fail('plan path must be absolute')
  let plan
  try { plan = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { fail(`cannot read plan: ${error.message}`) }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('plan must be a JSON object')
  return plan
}

function validateCommand(value, name) {
  if (!Array.isArray(value) || value.length === 0 || value.some(part => typeof part !== 'string' || part.length === 0)) {
    fail(`${name} must be a non-empty argv array`)
  }
  if (!isAbsolute(value[0])) fail(`${name}[0] must be an absolute executable path`)
  return value
}

function validatePlan(plan) {
  for (const name of ['recordsRoot', 'databasePath', 'runRoot']) {
    if (typeof plan[name] !== 'string' || !isAbsolute(plan[name])) fail(`${name} must be an absolute path`)
  }
  if (plan.backupRoot !== undefined && (typeof plan.backupRoot !== 'string' || !isAbsolute(plan.backupRoot))) fail('backupRoot must be absolute')
  if (plan.cwd !== undefined && (typeof plan.cwd !== 'string' || !isAbsolute(plan.cwd))) fail('cwd must be absolute')
  if (!Number.isInteger(plan.serverPid) || plan.serverPid <= 0) fail('serverPid must be a positive integer')
  if (!Number.isInteger(plan.port) || plan.port < 1 || plan.port > 65535) fail('port must be a valid TCP port')
  validateCommand(plan.oldCommand, 'oldCommand')
  validateCommand(plan.newCommand, 'newCommand')
  if (plan.env !== undefined && (!plan.env || typeof plan.env !== 'object' || Array.isArray(plan.env))) fail('env must be an object')
  if (plan.timeoutMs !== undefined && (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 1000)) fail('timeoutMs must be at least 1000')
  mkdirSync(plan.runRoot, { recursive: true })
  return { timeoutMs: plan.timeoutMs ?? 30_000 }
}

function alive(pid) {
  try {
    // A child that has closed its listener can remain a zombie until its original parent reaps it.
    // That is no longer a running writer, so do not mistake the kernel's Z state for a live server.
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    if (state === 'Z') return false
  } catch {
    // Non-Linux hosts do not expose /proc; the normal signal probe is the portable fallback.
  }
  try { process.kill(pid, 0); return true } catch { return false }
}

async function httpProbe(port, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1500) })
    const body = await response.text()
    return { status: response.status, body }
  } catch { return null }
}

async function waitFor(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(100)
  }
  fail(`timed out waiting for ${description}`)
}

async function assertHealthy(port, timeoutMs, label) {
  await waitFor(async () => (await httpProbe(port, '/health'))?.status === 200, timeoutMs, `${label} /health`)
  const sessions = await httpProbe(port, '/api/sessions?all=1')
  if (!sessions || sessions.status !== 200) fail(`${label} /api/sessions?all=1 returned ${sessions?.status ?? 'no response'}`)
  try {
    const parsed = JSON.parse(sessions.body)
    if (!Array.isArray(parsed)) fail(`${label} /api/sessions?all=1 did not return an array`)
    return { sessionCount: parsed.length }
  } catch { fail(`${label} /api/sessions?all=1 returned invalid JSON`) }
}

async function stopExact(pid, port, timeoutMs) {
  if (!alive(pid)) fail(`server pid ${pid} is not alive`)
  try { process.kill(pid, 'SIGTERM') } catch (error) { fail(`cannot stop server pid ${pid}: ${error.message}`) }
  await waitFor(async () => !alive(pid) && !(await httpProbe(port, '/health')), timeoutMs, `server pid ${pid} to stop and port ${port} to close`)
}

function start(command, plan) {
  const child = spawn(command[0], command.slice(1), {
    cwd: plan.cwd,
    env: { ...process.env, ...(plan.env ?? {}) },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child.pid
}

function quarantineArtifacts(plan, report) {
  const target = join(plan.runRoot, `failed-${now()}`)
  mkdirSync(target, { recursive: true })
  const candidates = [
    plan.databasePath,
    `${plan.databasePath}.json-migration.json`,
    jsonMigrationFencePath(plan.recordsRoot),
  ]
  const databaseDir = dirname(plan.databasePath)
  const databaseName = plan.databasePath.slice(databaseDir.length + 1)
  if (existsSync(databaseDir)) {
    for (const name of readdirSync(databaseDir)) {
      if (name.startsWith(`${databaseName}.migration-`) && name.endsWith('.tmp')) candidates.push(join(databaseDir, name))
    }
  }
  const moved = []
  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue
    const destination = join(target, path.split('/').at(-1))
    renameSync(path, destination)
    moved.push({ from: path, to: destination })
  }
  writeFileSync(join(target, 'failure.json'), JSON.stringify({ report, moved }, null, 2) + '\n')
  return target
}

async function main() {
  const plan = readPlan()
  const { timeoutMs } = validatePlan(plan)
  if (existsSync(`${plan.databasePath}.json-migration.json`)) fail('migration marker already exists; cutover is one-time')
  if (existsSync(plan.databasePath)) fail('database already exists without a migration marker')

  const oldHealth = await assertHealthy(plan.port, timeoutMs, 'old server')
  const startedAt = new Date().toISOString()
  let newPid
  let migration
  try {
    await stopExact(plan.serverPid, plan.port, timeoutMs)
    migration = migrateJsonSessionRecords({
      recordsRoot: plan.recordsRoot,
      databasePath: plan.databasePath,
      ...(plan.backupRoot ? { backupRoot: plan.backupRoot } : {}),
      locality: path => requireLocalDatabasePath(path),
    })
    newPid = start(plan.newCommand, plan)
    const newHealth = await assertHealthy(plan.port, timeoutMs, 'new server')
    const success = {
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      oldPid: plan.serverPid,
      newPid,
      oldHealth,
      newHealth,
      migration,
      planDigest: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    }
    writeFileSync(join(plan.runRoot, 'success.json'), JSON.stringify(success, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify(success, null, 2))
  } catch (error) {
    const report = { status: 'failed', error: error instanceof Error ? error.message : String(error), migration }
    if (newPid && alive(newPid)) {
      try { process.kill(newPid, 'SIGTERM') } catch { /* preserve the failure report */ }
      await waitFor(async () => !alive(newPid), timeoutMs, `new server pid ${newPid} to stop`).catch(() => {})
    }
    report.quarantine = quarantineArtifacts(plan, report)
    try {
      const oldPid = start(plan.oldCommand, plan)
      report.rollback = { oldPid, ...(await assertHealthy(plan.port, timeoutMs, 'rollback old server')) }
    } catch (rollbackError) {
      report.rollback = { error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }
    }
    console.error(JSON.stringify(report, null, 2))
    process.exitCode = 1
  }
}

await main()
