import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { repoRoot } from '@spexcode/spec-core'
import { readJsonConfig, runtimeRoot } from '@spexcode/spec-core'
import { processStartToken, writeDetachedRuntimeReceipt, type ProcessIdentity } from '@spexcode/spec-core'
export { processStartToken } from '@spexcode/spec-core'

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

type ProcBackendCandidate = BackendInstanceRecord & { candidatePid: number; command: string }

const procRows = (): number[] => {
  try { return readdirSync('/proc').filter((name) => /^\d+$/.test(name)).map(Number) } catch { return [] }
}

const procEnv = (pid: number): Record<string, string> => {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').flatMap((entry) => {
      const split = entry.indexOf('=')
      return split > 0 ? [[entry.slice(0, split), entry.slice(split + 1)] as const] : []
    }))
  } catch { return {} }
}

const procCommand = (pid: number): string => {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() } catch { return '' }
}

const procParent = (pid: number): number | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const close = stat.lastIndexOf(')')
    const fields = stat.slice(close + 2).split(' ')
    return Number(fields[1]) || null
  } catch { return null }
}

const isBackendCommand = (command: string): boolean =>
  /(?:^|\/)spec-cli\/(?:src\/index\.ts|dist\/index\.js)(?:\s|$)/.test(command)

/**
 * Reap only backend children whose supervisor identity is provably stale. A dead registry PID alone is not
 * enough: the live process must carry the exact instance id and project root, run the backend entrypoint, and
 * have been orphaned to PID 1. Ordinary launchers, shells, and app-server generations do not match.
 */
export function reapOrphanBackendInstances(root = repoRoot()): ProcBackendCandidate[] {
  const records = readBackendInstanceRecords(root)
  const liveCurrent = records.filter((record) => processStartToken(record.pid) === record.startToken)
  const currentIds = new Set(liveCurrent.map((record) => record.instanceId))
  const candidates: ProcBackendCandidate[] = []
  for (const record of records) {
    if (currentIds.has(record.instanceId)) continue
    if (processStartToken(record.pid) === record.startToken) continue
    for (const pid of procRows()) {
      const env = procEnv(pid)
      if (env.SPEXCODE_INSTANCE_ID !== record.instanceId || env.SPEXCODE_PROJECT_ROOT !== root) continue
      if (procParent(pid) !== 1) continue
      const command = procCommand(pid)
      if (!isBackendCommand(command)) continue
      candidates.push({ ...record, candidatePid: pid, command })
    }
  }
  for (const candidate of candidates) {
    try { process.kill(candidate.candidatePid, 'SIGTERM') } catch { /* exact process already exited */ }
    try { rmSync(backendInstancePath(candidate.instanceId), { force: true }) } catch { /* stale record is advisory */ }
  }
  return candidates
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
