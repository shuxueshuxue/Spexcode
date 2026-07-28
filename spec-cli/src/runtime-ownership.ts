import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { repoRoot } from './git.js'
import { readJsonConfig, runtimeRoot } from './layout.js'
import { processStartToken, writeDetachedRuntimeReceipt, type ProcessIdentity } from './process-identity.js'

export type BackendInstanceRecord = {
  version: 1
  instanceId: string
  pid: number
  startToken: string
  projectRoot: string
  startedAt: string
}

const backendInstancesDir = () => join(runtimeRoot(), 'backend-instances')
const backendInstancePath = (instanceId: string) => join(backendInstancesDir(), `${instanceId}.json`)

const atomicJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export function readBackendInstanceRecords(root = repoRoot()): BackendInstanceRecord[] {
  let names: string[]
  try { names = readdirSync(backendInstancesDir()) } catch { return [] }
  return names.flatMap((name) => {
    try {
      const rec = readJsonConfig(join(backendInstancesDir(), name)) as BackendInstanceRecord
      return rec?.version === 1 && rec.projectRoot === root ? [rec] : []
    } catch { return [] }
  })
}

export function registerBackendInstance(instanceId: string, pid = process.pid, root = repoRoot()): BackendInstanceRecord {
  const startToken = processStartToken(pid)
  if (!startToken) throw new Error(`cannot identify backend supervisor PID ${pid}`)
  const record: BackendInstanceRecord = { version: 1, instanceId, pid, startToken, projectRoot: root, startedAt: new Date().toISOString() }
  atomicJson(backendInstancePath(instanceId), record)
  return record
}

export function unregisterBackendInstance(instanceId: string, pid = process.pid): void {
  try {
    const record = readJsonConfig(backendInstancePath(instanceId)) as BackendInstanceRecord
    if (record.instanceId === instanceId && record.pid === pid && record.startToken === processStartToken(pid)) rmSync(backendInstancePath(instanceId), { force: true })
  } catch { /* not ours / already removed */ }
}

export function spawnDetachedRuntime(opts: {
  cwd: string
  logFile: string
  pidFile: string
  receiptFile: string
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}): ProcessIdentity {
  mkdirSync(dirname(opts.logFile), { recursive: true })
  mkdirSync(dirname(opts.pidFile), { recursive: true })
  const log = openSync(opts.logFile, 'a', 0o600)
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
      stdio: ['ignore', log, log],
    })
  } finally { closeSync(log) }
  child.once('error', () => {})
  if (!child.pid) throw new Error(`could not spawn detached shared runtime: ${opts.command}`)
  child.unref()
  try {
    const identity = writeDetachedRuntimeReceipt(child.pid, opts.receiptFile)
    writeFileSync(opts.pidFile, `${child.pid}\n`, { mode: 0o600 })
    return { pid: identity.pid, startToken: identity.startToken }
  } catch (error) {
    try { child.kill('SIGTERM') } catch { /* exact just-spawned child already exited */ }
    rmSync(opts.pidFile, { force: true })
    rmSync(opts.receiptFile, { force: true })
    throw error
  }
}
