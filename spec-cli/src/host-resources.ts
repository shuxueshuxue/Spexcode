import { cpus, platform } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { defaultHarness, HARNESSES, harnessById, sessionIdentityEnvVars, type HarnessLivenessRecord, type SharedRuntimeDescriptor, type SharedRuntimeProbe } from './harness.js'
import { listSessionIds, readConfig, readJsonConfig, readRawRecord, runtimeRoot, type RawRecord } from './layout.js'
import { repoRoot } from './git.js'
import { endpointRecordPath } from './host.js'
import { parseProcStat, processStartToken, processTopology, type ProcessIdentity } from './process-identity.js'
import { readBackendInstanceRecords, type BackendInstanceRecord } from './runtime-ownership.js'

type Proc = ProcessIdentity & {
  ppid: number
  ticks: number
  rssKiB: number
  pssKiB: number | null
  cpuPercent: number
  command: string
  env: Record<string, string>
}

export type ResourceReference = {
  sessionId: string | null
  threadId: string | null
  status: string | null
  ownerState: 'governed' | 'unowned' | 'ambiguous'
  referenceState: 'loaded' | 'record-only' | 'queued-no-thread'
  turnPresence: 'active' | 'idle' | 'unknown' | 'none'
  protectsControlPlane: boolean
}

export type ResourceOwner = {
  kind: 'session' | 'shared-runtime' | 'backend' | 'orphan' | 'unattributed'
  id: string
  label: string
  status?: string
  proposal?: string | null
  worktreePath?: string
  branch?: string | null
  stopped?: boolean
  archived?: boolean
  processes: Array<ProcessIdentity & { command: string; rssMiB: number; pssMiB: number | null; cpuPercent: number }>
  rssMiB: number
  pssMiB: number | null
  cpuPercent: number
  budget: { rssMiB: number | null; idleCpuPercent: number | null }
  controlPlane?: { healthy: boolean; refCount: number | null; error?: string }
  references?: ResourceReference[]
  findings: string[]
  reclaim?: { eligible: boolean; reason: string }
}

export type ResourceReport = {
  version: 1
  measuredAt: string
  projectRoot: string
  platform: string
  available: boolean
  unavailableReason?: string
  host: {
    memoryTotalMiB: number | null
    memoryUsedMiB: number | null
    memoryAvailableMiB: number | null
    swapTotalMiB: number | null
    swapUsedMiB: number | null
    cpuPercent: number | null
  }
  budgets: ResourceBudgets
  owners: ResourceOwner[]
  totals: { rssMiB: number; pssMiB: number | null; cpuPercent: number }
  findings: number
}

export type ResourceBudgets = {
  sessionRssMiB: number
  backendRssMiB: number
  idleCpuPercent: number
  sampleMs: number
  reportIntervalMs: number
}

const DEFAULTS: ResourceBudgets = {
  sessionRssMiB: 1024,
  backendRssMiB: 2048,
  idleCpuPercent: 2,
  sampleMs: 1000,
  reportIntervalMs: 60_000,
}

export class ResourceConflict extends Error {
  constructor(message: string, readonly code = 'resource-conflict') {
    super(message)
    this.name = 'ResourceConflict'
  }
}

const finitePositive = (value: unknown, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new ResourceConflict(`resources.${name} must be a positive number`)
  return n
}

export function resourceBudgets(root = repoRoot()): ResourceBudgets {
  const r = readConfig(root).resources ?? {}
  return {
    sessionRssMiB: finitePositive(r.sessionRssMiB, DEFAULTS.sessionRssMiB, 'sessionRssMiB'),
    backendRssMiB: finitePositive(r.backendRssMiB, DEFAULTS.backendRssMiB, 'backendRssMiB'),
    idleCpuPercent: finitePositive(r.idleCpuPercent, DEFAULTS.idleCpuPercent, 'idleCpuPercent'),
    sampleMs: Math.max(50, Math.floor(finitePositive(r.sampleMs, DEFAULTS.sampleMs, 'sampleMs'))),
    reportIntervalMs: Math.max(5000, Math.floor(finitePositive(r.reportIntervalMs, DEFAULTS.reportIntervalMs, 'reportIntervalMs'))),
  }
}

const readSelectedEnv = (path: string): Record<string, string> => {
  let raw: string
  try { raw = readFileSync(path, 'utf8') } catch { return {} }
  const wanted = new Set([...sessionIdentityEnvVars(), 'SPEXCODE_PROJECT_ROOT', 'SPEXCODE_INSTANCE_ID'])
  const out: Record<string, string> = {}
  for (const entry of raw.split('\0')) {
    const at = entry.indexOf('=')
    if (at > 0 && wanted.has(entry.slice(0, at))) out[entry.slice(0, at)] = entry.slice(at + 1)
  }
  return out
}

const readPss = (path: string): number | null => {
  try {
    const hit = readFileSync(path, 'utf8').match(/^Pss:\s+(\d+)\s+kB$/m)
    return hit ? Number(hit[1]) : null
  } catch { return null }
}

let pageKiBCache: number | null = null
const pageKiB = () => {
  if (pageKiBCache !== null) return pageKiBCache
  try { pageKiBCache = Number(execFileSync('getconf', ['PAGESIZE'], { encoding: 'utf8' }).trim()) / 1024 }
  catch { pageKiBCache = 4 }
  return pageKiBCache
}
const procSnapshot = (procRoot = '/proc', withDetails = true): Map<number, Proc> => {
  const out = new Map<number, Proc>()
  let dirs: string[]
  try { dirs = readdirSync(procRoot).filter((name) => /^\d+$/.test(name)) } catch { return out }
  for (const name of dirs) {
    const pid = Number(name)
    try {
      const stat = parseProcStat(readFileSync(join(procRoot, name, 'stat'), 'utf8'))
      const command = withDetails
        ? readFileSync(join(procRoot, name, 'comm'), 'utf8').trim()
        : ''
      out.set(pid, {
        pid,
        ppid: stat.ppid,
        ticks: stat.ticks,
        startToken: stat.startToken,
        rssKiB: stat.rssPages * pageKiB(),
        pssKiB: withDetails ? readPss(join(procRoot, name, 'smaps_rollup')) : null,
        cpuPercent: 0,
        command,
        env: withDetails ? readSelectedEnv(join(procRoot, name, 'environ')) : {},
      })
    } catch { /* process exited or is unreadable during the snapshot */ }
  }
  return out
}

const totalCpuTicks = (procRoot = '/proc'): number => {
  try {
    const line = readFileSync(join(procRoot, 'stat'), 'utf8').split('\n')[0]
    return line.split(/\s+/).slice(1).reduce((n, value) => n + Number(value || 0), 0)
  } catch { return 0 }
}

const hostCpuSnapshot = (procRoot = '/proc'): { total: number; idle: number } | null => {
  try {
    const fields = readFileSync(join(procRoot, 'stat'), 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number)
    return { total: fields.reduce((n, value) => n + (value || 0), 0), idle: (fields[3] || 0) + (fields[4] || 0) }
  } catch { return null }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const descendants = (root: number, procs: Map<number, Proc>): Set<number> => {
  const ids = new Set<number>([root])
  let changed = true
  while (changed) {
    changed = false
    for (const p of procs.values()) if (!ids.has(p.pid) && ids.has(p.ppid)) { ids.add(p.pid); changed = true }
  }
  return ids
}

const records = (): RawRecord[] => listSessionIds().map(readRawRecord).filter((r): r is RawRecord => !!r)
const runtimePid = (file: string): number | null => {
  try { const pid = Number(readFileSync(file, 'utf8').trim()); return Number.isFinite(pid) && pid > 0 ? pid : null }
  catch { return null }
}
type SharedEntry = { descriptor: SharedRuntimeDescriptor; recs: RawRecord[] }
const sharedDescriptors = (recs: RawRecord[], retainRegistry = false): Map<string, SharedEntry> => {
  const out = new Map<string, { descriptor: SharedRuntimeDescriptor; recs: RawRecord[] }>()
  for (const harness of HARNESSES) for (const descriptor of harness.sharedRuntimes?.(runtimeRoot()) ?? []) {
    if (!out.has(descriptor.key)) out.set(descriptor.key, { descriptor, recs: [] })
  }
  for (const rec of recs) {
    // Keep archived records in the adapter join so a stale loaded thread is attributed to its real record and
    // reported as an archive hazard. Clean archived records carry stopped:true and no loaded reference, so they
    // contribute nothing to the active set while still preserving exact ownership if the invariant is violated.
    if (!rec.governed) continue
    const harness = harnessById(rec.harness || defaultHarness.id)
    for (const descriptor of harness.sharedRuntimes?.(runtimeRoot()) ?? []) {
      const entry = out.get(descriptor.key) ?? { descriptor, recs: [] }
      entry.recs.push(rec)
      out.set(descriptor.key, entry)
    }
  }
  if (!retainRegistry) for (const [key, entry] of out) if (!entry.recs.length && !runtimePid(entry.descriptor.pidFile)) out.delete(key)
  return out
}

const projectReferences = (entry: SharedEntry, probe: SharedRuntimeProbe): ResourceReference[] => {
  const byThread = new Map<string, RawRecord[]>()
  for (const rec of entry.recs) if (rec.harness_session_id) byThread.set(rec.harness_session_id, [...(byThread.get(rec.harness_session_id) ?? []), rec])
  const observed = probe.healthy ? probe.references : []
  const live = observed.map((reference): ResourceReference => {
    const owners = byThread.get(reference.referenceId) ?? []
    if (owners.length !== 1) return {
      sessionId: null,
      threadId: reference.referenceId,
      status: null,
      ownerState: owners.length ? 'ambiguous' : 'unowned',
      referenceState: 'loaded',
      turnPresence: reference.turnPresence,
      protectsControlPlane: true,
    }
    const rec = owners[0]
    return {
      sessionId: rec.session_id,
      threadId: reference.referenceId,
      status: rec.status,
      ownerState: 'governed',
      referenceState: 'loaded',
      turnPresence: reference.turnPresence,
      protectsControlPlane: true,
    }
  })
  const loaded = new Set(observed.map((reference) => reference.referenceId))
  for (const rec of entry.recs) {
    if (rec.stopped || (rec.harness_session_id && loaded.has(rec.harness_session_id))) continue
    live.push({
      sessionId: rec.session_id,
      threadId: rec.harness_session_id ?? null,
      status: rec.status,
      ownerState: 'governed',
      referenceState: rec.harness_session_id ? 'record-only' : 'queued-no-thread',
      turnPresence: 'none',
      protectsControlPlane: false,
    })
  }
  return live
}

type Inventory = { procs: Map<number, Proc>; recs: RawRecord[]; ownership: Map<number, string>; shared: ReturnType<typeof sharedDescriptors>; backendPid: number | null; backendInstance: string | null; backendInstances: BackendInstanceRecord[] }

const buildInventory = (procs: Map<number, Proc>): Inventory => {
  const recs = records()
  const activeRecs = recs.filter((rec) => {
    if (!rec.archived) return true
    // A legacy archived row with a resident leaf is a visible hazard, not clean cold storage. Keep charging
    // that exact process until an explicit archive repair succeeds; truly cold records stay out of the active set.
    const pid = runtimePid(join(runtimeRoot(), 'sessions', rec.session_id, 'agent.pid'))
    return !!pid && procs.has(pid)
  })
  const byId = new Map(activeRecs.map((rec) => [rec.session_id, rec.session_id]))
  for (const rec of activeRecs) if (rec.harness_session_id) byId.set(rec.harness_session_id, rec.session_id)
  const ownership = new Map<number, string>()
  const adapterVars = sessionIdentityEnvVars().filter((v) => v !== 'SPEXCODE_SESSION_ID')
  const actingSession = (p: Proc): string | undefined => {
    const acting = adapterVars.map((key) => p.env[key]).find((value) => value && byId.has(value))
    return acting ? byId.get(acting) : undefined
  }
  for (const p of procs.values()) {
    const acting = actingSession(p)
    const fallback = p.env.SPEXCODE_SESSION_ID
    const sid = acting ?? (fallback ? byId.get(fallback) : undefined)
    if (sid) ownership.set(p.pid, `session:${sid}`)
  }
  for (const rec of activeRecs) {
    const root = runtimePid(join(runtimeRoot(), 'sessions', rec.session_id, 'agent.pid'))
    if (root && procs.has(root)) for (const pid of descendants(root, procs)) if (!ownership.has(pid)) ownership.set(pid, `session:${rec.session_id}`)
  }

  const shared = sharedDescriptors(recs)
  for (const [key, entry] of shared) {
    const root = runtimePid(entry.descriptor.pidFile)
    if (root && procs.has(root)) for (const pid of descendants(root, procs)) {
      const proc = procs.get(pid)!
      // A legacy shared daemon may carry its first launcher's fallback session id. The registered root and
      // descendants without a known acting thread still belong to the control plane; real per-thread tools
      // carry the adapter's thread id and retain their session charge.
      if (pid === root || !actingSession(proc)) ownership.set(pid, `shared:${key}`)
    }
  }

  // Endpoint records are served-tree slots, while sessions/shared runtimes/instance history use the Git
  // common-dir project slot. Reuse the endpoint seam instead of assuming both identities have one path.
  const backend = readJsonConfig(endpointRecordPath(repoRoot())) as { pid?: number; instanceId?: string }
  const backendPid = Number.isFinite(Number(backend.pid)) ? Number(backend.pid) : null
  const backendInstance = typeof backend.instanceId === 'string' ? backend.instanceId : null
  if (backendPid && procs.has(backendPid)) for (const pid of descendants(backendPid, procs)) {
    if (!ownership.has(pid)) ownership.set(pid, `backend:${backendInstance || backendPid}`)
  }
  const backendInstances = readBackendInstanceRecords(repoRoot())
  for (const instance of backendInstances) {
    if (processStartToken(instance.pid) !== instance.startToken || !procs.has(instance.pid)) continue
    const current = instance.pid === backendPid && instance.instanceId === backendInstance
    const key = current ? `backend:${instance.instanceId}` : `orphan:backend:${instance.instanceId}`
    for (const pid of descendants(instance.pid, procs)) if (!ownership.has(pid)) ownership.set(pid, key)
  }

  const root = repoRoot()
  for (const p of procs.values()) {
    if (ownership.has(p.pid) || p.env.SPEXCODE_PROJECT_ROOT !== root) continue
    const claimed = p.env.SPEXCODE_SESSION_ID
    if (claimed && !byId.has(claimed)) ownership.set(p.pid, `orphan:session:${claimed}`)
    else if (p.env.SPEXCODE_INSTANCE_ID && p.env.SPEXCODE_INSTANCE_ID !== backendInstance) ownership.set(p.pid, `orphan:backend:${p.env.SPEXCODE_INSTANCE_ID}`)
    else ownership.set(p.pid, 'unattributed:project')
  }
  return { procs, recs, ownership, shared, backendPid, backendInstance, backendInstances }
}

const mib = (kib: number) => Math.round((kib / 1024) * 10) / 10
const ownerProcesses = (ids: number[], procs: Map<number, Proc>) => ids.map((pid) => procs.get(pid)!).filter(Boolean).map((p) => ({
  pid: p.pid,
  startToken: p.startToken,
  command: p.command,
  rssMiB: mib(p.rssKiB),
  pssMiB: p.pssKiB === null ? null : mib(p.pssKiB),
  cpuPercent: Math.round(p.cpuPercent * 10) / 10,
}))

const ownerTotals = (processes: ResourceOwner['processes']) => ({
  rssMiB: Math.round(processes.reduce((n, p) => n + p.rssMiB, 0) * 10) / 10,
  pssMiB: processes.every((p) => p.pssMiB !== null) ? Math.round(processes.reduce((n, p) => n + (p.pssMiB ?? 0), 0) * 10) / 10 : null,
  cpuPercent: Math.round(processes.reduce((n, p) => n + p.cpuPercent, 0) * 10) / 10,
})

const terminal = (rec: RawRecord | undefined) => !!rec && rec.status === 'awaiting' && (rec.proposal === 'nothing' || rec.proposal === 'close')

const probeRuntime = async (descriptor: SharedRuntimeDescriptor): Promise<SharedRuntimeProbe> => {
  try { return await descriptor.probe() }
  catch (error) { return { healthy: false, references: [], error: (error as Error).message } }
}

const sessionStopBlocker = async (
  id: string,
  harnessId: string | null,
  recs = records(),
  knownProbes?: Map<string, SharedRuntimeProbe>,
): Promise<string | null> => {
  const allowed = harnessId
    ? new Set((harnessById(harnessId).sharedRuntimes?.(runtimeRoot()) ?? []).map((descriptor) => descriptor.key))
    : null
  for (const [key, entry] of sharedDescriptors(recs, true)) {
    if (allowed && !allowed.has(key)) continue
    const descriptor = entry.descriptor
    const pid = runtimePid(descriptor.pidFile)
    const startToken = pid ? processStartToken(pid) : null
    const ownerCounts = new Map<string, number>()
    for (const rec of entry.recs) if (rec.harness_session_id) ownerCounts.set(rec.harness_session_id, (ownerCounts.get(rec.harness_session_id) ?? 0) + 1)
    const targetThread = entry.recs.find((rec) => rec.session_id === id)?.harness_session_id
    if (targetThread && ownerCounts.get(targetThread) !== 1)
      return `${descriptor.label} target thread ${targetThread} has no one exact governed session owner`
    if (!knownProbes && descriptor.mutationGuard) {
      if (!targetThread) return `${descriptor.label} target has no exact governed thread identity`
      if (!pid) return `${descriptor.label} target-scoped mutation guard has no readable owner PID`
      if (!startToken) return `${descriptor.label} PID ${pid} target-scoped mutation guard has no readable process-start identity`
      const topologyBefore = processTopology(pid)
      let stampBefore = ''
      try { stampBefore = readFileSync(descriptor.isolationFile, 'utf8').trim() } catch { /* legacy unsafe runtime */ }
      if (!topologyBefore || topologyBefore.startToken !== startToken || topologyBefore.processGroupId !== pid || topologyBefore.sessionId !== pid ||
        stampBefore !== `detached-v3 ${pid} ${startToken} ${pid} ${pid}`)
        return `${descriptor.label} PID ${pid}@${startToken} has no matching live detached process-boundary record`
      let guard
      try { guard = await descriptor.mutationGuard(targetThread) }
      catch (error) { return `${descriptor.label} target-scoped mutation guard failed: ${(error as Error).message}` }
      const startAfter = processStartToken(pid)
      const topologyAfter = processTopology(pid)
      let stampAfter = ''
      try { stampAfter = readFileSync(descriptor.isolationFile, 'utf8').trim() } catch { /* changed/missing identity */ }
      if (startAfter !== startToken || !topologyAfter || topologyAfter.startToken !== startToken ||
        topologyAfter.processGroupId !== pid || topologyAfter.sessionId !== pid || stampAfter !== stampBefore)
        return `${descriptor.label} PID/start/isolation identity changed during target-scoped mutation guard`
      if (guard.descendantIds.length)
        return `${descriptor.label} target thread ${targetThread} has owned descendants (${guard.descendantIds.join(', ')})`
      if (!guard.healthy)
        return `${descriptor.label} target thread ${targetThread} is unknown: ${guard.error || 'target-scoped mutation guard failed'}`
      if (guard.targetTurnPresence === 'active') return `${descriptor.label} target thread ${targetThread} has an active turn`
      if (guard.targetTurnPresence === 'unknown') return `${descriptor.label} target thread ${targetThread} turn state is unknown`
      continue
    }
    const probe = knownProbes?.get(descriptor.key) ?? await probeRuntime(descriptor)
    const targetRef = probe.healthy && targetThread ? probe.references.find((reference) => reference.referenceId === targetThread) : undefined
    const siblings = probe.healthy ? probe.references.filter((reference) => !targetThread || reference.referenceId !== targetThread) : []
    const liveReason = siblings.length
      ? `${siblings.length} live sibling thread(s)`
      : probe.healthy ? `${probe.references.length} live thread reference(s)` : 'an unproven live reference set'
    if (!pid) return `${descriptor.label} has ${liveReason} but no readable owner PID`
    if (!startToken) return `${descriptor.label} PID ${pid} has ${liveReason} but no readable process-start identity`
    const topology = processTopology(pid)
    let stamp = ''
    try { stamp = readFileSync(descriptor.isolationFile, 'utf8').trim() } catch { /* legacy unsafe runtime */ }
    if (!topology || topology.startToken !== startToken || topology.processGroupId !== pid || topology.sessionId !== pid ||
      stamp !== `detached-v3 ${pid} ${startToken} ${pid} ${pid}`) {
      const refs = probe.references.map((reference) => reference.referenceId).join(', ') || 'no loaded threads'
      return `${descriptor.label} PID ${pid}@${startToken} serves ${refs} and has no matching live detached process-boundary record`
    }
    if (!probe.healthy)
      return `${descriptor.label} PID ${pid}@${startToken} has an unproven live reference set: ${probe.error || 'unknown probe failure'}`
  }
  return null
}

const probeShared = async (shared: Map<string, SharedEntry>): Promise<Map<string, SharedRuntimeProbe>> => new Map(await Promise.all(
  [...shared].map(async ([key, entry]) => [key, await probeRuntime(entry.descriptor)] as const),
))

const sharedFindings = (references: ResourceReference[], probe: SharedRuntimeProbe): string[] => {
  const findings: string[] = []
  if (!probe.healthy) findings.push(`control-plane-probe-failed:${probe.error || 'unknown'}`)
  if (references.some((ref) => ref.ownerState === 'unowned')) findings.push('unowned-loaded-thread')
  if (references.some((ref) => ref.ownerState === 'ambiguous')) findings.push('ambiguous-loaded-thread-owner')
  if (references.some((ref) => ref.turnPresence === 'unknown')) findings.push('turn-presence-unknown')
  if (references.some((ref) => ref.referenceState !== 'loaded')) findings.push('record-without-live-thread')
  return findings
}
const atomicJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

const memInfo = (procRoot = '/proc') => {
  const values: Record<string, number> = {}
  try {
    for (const line of readFileSync(join(procRoot, 'meminfo'), 'utf8').split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/)
      if (m) values[m[1]] = Number(m[2])
    }
  } catch { /* unavailable below */ }
  const total = values.MemTotal
  const available = values.MemAvailable
  const swapTotal = values.SwapTotal
  const swapFree = values.SwapFree
  return {
    memoryTotalMiB: total ? mib(total) : null,
    memoryUsedMiB: total && available !== undefined ? mib(total - available) : null,
    memoryAvailableMiB: available !== undefined ? mib(available) : null,
    swapTotalMiB: swapTotal !== undefined ? mib(swapTotal) : null,
    swapUsedMiB: swapTotal !== undefined && swapFree !== undefined ? mib(swapTotal - swapFree) : null,
  }
}

export async function collectResourceReport(opts: { procRoot?: string; persist?: boolean } = {}): Promise<ResourceReport> {
  const root = repoRoot()
  const budgets = resourceBudgets(root)
  if (platform() !== 'linux' && !opts.procRoot) {
    const recs = records()
    const owners: ResourceOwner[] = []
    const shared = sharedDescriptors(recs)
    const probes = await probeShared(shared)
    for (const [key, entry] of shared) {
      const probe = probes.get(key)!
      const refs = projectReferences(entry, probe)
      owners.push({ kind: 'shared-runtime', id: key, label: entry.descriptor.label, processes: [], rssMiB: 0, pssMiB: null, cpuPercent: 0, budget: { rssMiB: null, idleCpuPercent: null }, controlPlane: { healthy: probe.healthy, refCount: probe.healthy ? probe.references.length : null, ...(probe.error ? { error: probe.error } : {}) }, references: refs, findings: sharedFindings(refs, probe) })
    }
    const report: ResourceReport = { version: 1, measuredAt: new Date().toISOString(), projectRoot: root, platform: platform(), available: false, unavailableReason: `host process metrics are unavailable on ${platform()}; shared runtime references remain visible`, host: { memoryTotalMiB: null, memoryUsedMiB: null, memoryAvailableMiB: null, swapTotalMiB: null, swapUsedMiB: null, cpuPercent: null }, budgets, owners, totals: { rssMiB: 0, pssMiB: null, cpuPercent: 0 }, findings: owners.reduce((n, o) => n + o.findings.length, 0) }
    if (opts.persist !== false) atomicJson(join(runtimeRoot(), 'resource-report.json'), report)
    return report
  }

  const procRoot = opts.procRoot ?? '/proc'
  const first = procSnapshot(procRoot)
  const hostBefore = hostCpuSnapshot(procRoot)
  const cpuBefore = hostBefore?.total ?? totalCpuTicks(procRoot)
  await sleep(budgets.sampleMs)
  const second = procSnapshot(procRoot, false)
  const hostAfter = hostCpuSnapshot(procRoot)
  const cpuAfter = hostAfter?.total ?? totalCpuTicks(procRoot)
  const totalDelta = Math.max(1, cpuAfter - cpuBefore)
  for (const p of first.values()) {
    const next = second.get(p.pid)
    if (next && next.startToken === p.startToken) p.cpuPercent = Math.max(0, (next.ticks - p.ticks) / totalDelta * cpus().length * 100)
  }

  const inv = buildInventory(first)
  const sharedProbes = await probeShared(inv.shared)
  const grouped = new Map<string, number[]>()
  for (const [pid, owner] of inv.ownership) grouped.set(owner, [...(grouped.get(owner) ?? []), pid])
  const bySession = new Map(inv.recs.map((rec) => [rec.session_id, rec]))
  const owners: ResourceOwner[] = []

  for (const [owner, ids] of grouped) {
    const processes = ownerProcesses(ids, first)
    const totals = ownerTotals(processes)
    let kind: ResourceOwner['kind'] = 'unattributed'
    let id = owner
    let label = owner
    let status: string | undefined
    let lifecycle: Pick<ResourceOwner, 'proposal' | 'worktreePath' | 'branch' | 'stopped' | 'archived'> | undefined
    let rssBudget: number | null = null
    let idleBudget: number | null = null
    let references: ResourceReference[] | undefined
    let controlPlane: ResourceOwner['controlPlane']
    const findings: string[] = []
    let reclaim: ResourceOwner['reclaim']

    if (owner.startsWith('session:')) {
      kind = 'session'; id = owner.slice(8); label = `session ${id.slice(0, 8)}`
      const rec = bySession.get(id); status = rec?.status; rssBudget = budgets.sessionRssMiB; idleBudget = budgets.idleCpuPercent
      if (rec) lifecycle = { proposal: rec.proposal, worktreePath: rec.worktree_path, branch: rec.branch, stopped: rec.stopped, archived: rec.archived }
      if (rec?.archived) findings.push('archived-runtime-hazard:leaf-still-resident')
      if (totals.rssMiB > rssBudget) findings.push(`rss-over-budget:${Math.round((totals.rssMiB - rssBudget) * 10) / 10}MiB`)
      if (status !== 'active' && status !== 'queued' && totals.cpuPercent > idleBudget) findings.push(`idle-cpu-over-budget:${Math.round((totals.cpuPercent - idleBudget) * 10) / 10}%`)
      const stopBlocker = rec ? await sessionStopBlocker(id, rec.harness || defaultHarness.id, inv.recs, sharedProbes) : null
      if (terminal(rec) && totals.cpuPercent <= idleBudget && !stopBlocker) {
        reclaim = { eligible: true, reason: `terminal lifecycle ${rec!.status}/${rec!.proposal}; a future exact action must revalidate every fact` }
      } else reclaim = { eligible: false, reason: stopBlocker ? `shared runtime unsafe: ${stopBlocker}` : terminal(rec) ? 'terminal record is still consuming CPU; liveness contradicts safe retirement' : 'owner is not terminal; budget age/status alone never authorizes stop' }
    } else if (owner.startsWith('shared:')) {
      kind = 'shared-runtime'; id = owner.slice(7)
      const shared = inv.shared.get(id)!; label = shared.descriptor.label; rssBudget = budgets.backendRssMiB; idleBudget = budgets.idleCpuPercent
      const probe = sharedProbes.get(id)!
      references = projectReferences(shared, probe)
      if (references.some((reference) => reference.sessionId && bySession.get(reference.sessionId)?.archived)) findings.push('archived-runtime-hazard:loaded-thread')
      controlPlane = { healthy: probe.healthy, refCount: probe.healthy ? probe.references.length : null, ...(probe.error ? { error: probe.error } : {}) }
      if (totals.rssMiB > rssBudget) findings.push(`rss-over-budget:${Math.round((totals.rssMiB - rssBudget) * 10) / 10}MiB`)
      const protectedReferences = references.filter((reference) => reference.protectsControlPlane)
      const turnPresenceKnown = !references.some((reference) => reference.turnPresence === 'unknown')
      if (probe.healthy && turnPresenceKnown && !references.some((reference) => reference.turnPresence === 'active') && totals.cpuPercent > idleBudget) findings.push(`idle-cpu-over-budget:${Math.round((totals.cpuPercent - idleBudget) * 10) / 10}%`)
      if (probe.healthy && protectedReferences.length === 0) findings.push('orphan-shared-runtime:no-live-references')
      findings.push(...sharedFindings(references, probe))
      if (ids.some((pid) => sessionIdentityEnvVars().some((key) => !!first.get(pid)?.env[key]))) findings.push('identity-leak:project-control-plane-carries-session-id')
      reclaim = { eligible: false, reason: !probe.healthy ? 'live reference count unknown; adapter/project teardown only' : protectedReferences.length ? `protected by ${protectedReferences.length} loaded/active thread reference(s)` : 'shared runtime teardown belongs to its adapter/project owner, never session stop' }
    } else if (owner.startsWith('backend:')) {
      kind = 'backend'; id = owner.slice(8); label = `backend ${id}`; rssBudget = budgets.backendRssMiB; idleBudget = budgets.idleCpuPercent
      if (totals.rssMiB > rssBudget) findings.push(`rss-over-budget:${Math.round((totals.rssMiB - rssBudget) * 10) / 10}MiB`)
      if (totals.cpuPercent > idleBudget) findings.push(`idle-cpu-over-budget:${Math.round((totals.cpuPercent - idleBudget) * 10) / 10}%`)
      if (ids.some((pid) => sessionIdentityEnvVars().some((key) => !!first.get(pid)?.env[key]))) findings.push('identity-leak:project-control-plane-carries-session-id')
      reclaim = { eligible: false, reason: 'current endpoint owner; backend teardown is not a session stop' }
    } else if (owner.startsWith('orphan:')) {
      kind = 'orphan'; id = owner.slice(7); label = owner; findings.push('orphan:owner-record-absent')
      if (id.startsWith('session:')) {
        const exactOwner = id.slice(8)
        id = exactOwner
        label = `orphan session ${exactOwner}`
        reclaim = { eligible: true, reason: 'process carries this project and session identity, but the owner record is absent' }
      } else if (id.startsWith('backend:')) {
        const exactOwner = id.slice(8)
        id = exactOwner
        label = `orphan backend ${exactOwner}`
        rssBudget = budgets.backendRssMiB
        idleBudget = budgets.idleCpuPercent
        if (totals.rssMiB > rssBudget) findings.push(`rss-over-budget:${Math.round((totals.rssMiB - rssBudget) * 10) / 10}MiB`)
        if (totals.cpuPercent > idleBudget) findings.push(`idle-cpu-over-budget:${Math.round((totals.cpuPercent - idleBudget) * 10) / 10}%`)
        reclaim = { eligible: false, reason: 'superseded backend generation remains owned by backend supervisor teardown, never session stop' }
      } else reclaim = { eligible: false, reason: 'runtime teardown belongs to its registered owner' }
    } else {
      findings.push('unattributed:project-process-without-owner')
      reclaim = { eligible: false, reason: 'ownership is insufficient; reporting stays read-only' }
    }
    owners.push({ kind, id, label, ...(status ? { status } : {}), ...(lifecycle ?? {}), processes, ...totals, budget: { rssMiB: rssBudget, idleCpuPercent: idleBudget }, ...(controlPlane ? { controlPlane } : {}), ...(references ? { references } : {}), findings, ...(reclaim ? { reclaim } : {}) })
  }

  // A referenced shared runtime with no readable process is still operationally important: keep its live or
  // unknown refcount visible instead of silently omitting it from a process-derived report.
  for (const [key, shared] of inv.shared) if (!owners.some((o) => o.kind === 'shared-runtime' && o.id === key)) {
    const probe = sharedProbes.get(key)!
    const references = projectReferences(shared, probe)
    const protectedReferences = references.filter((reference) => reference.protectsControlPlane)
    owners.push({ kind: 'shared-runtime', id: key, label: shared.descriptor.label, processes: [], rssMiB: 0, pssMiB: null, cpuPercent: 0, budget: { rssMiB: budgets.backendRssMiB, idleCpuPercent: null }, controlPlane: { healthy: probe.healthy, refCount: probe.healthy ? probe.references.length : null, ...(probe.error ? { error: probe.error } : {}) }, references, findings: ['runtime-process-unavailable', ...sharedFindings(references, probe)], reclaim: { eligible: false, reason: !probe.healthy ? 'live reference count unknown; adapter/project teardown only' : protectedReferences.length ? `protected by ${protectedReferences.length} loaded/active thread reference(s)` : 'adapter/project teardown only' } })
  }

  owners.sort((a, b) => b.rssMiB - a.rssMiB || a.id.localeCompare(b.id))
  const rssMiB = Math.round(owners.reduce((n, o) => n + o.rssMiB, 0) * 10) / 10
  const pssMiB = owners.every((o) => o.pssMiB !== null) ? Math.round(owners.reduce((n, o) => n + (o.pssMiB ?? 0), 0) * 10) / 10 : null
  const cpuPercent = Math.round(owners.reduce((n, o) => n + o.cpuPercent, 0) * 10) / 10
  const report: ResourceReport = {
    version: 1,
    measuredAt: new Date().toISOString(),
    projectRoot: root,
    platform: platform(),
    available: true,
    host: {
      ...memInfo(procRoot),
      cpuPercent: hostBefore && hostAfter && hostAfter.total > hostBefore.total
        ? Math.round((1 - (hostAfter.idle - hostBefore.idle) / (hostAfter.total - hostBefore.total)) * 1000) / 10
        : null,
    },
    budgets,
    owners,
    totals: { rssMiB, pssMiB, cpuPercent },
    findings: owners.reduce((n, owner) => n + owner.findings.length, 0),
  }
  if (opts.persist !== false) atomicJson(join(runtimeRoot(), 'resource-report.json'), report)
  return report
}

export async function assertSessionStopSafe(id: string, rec: (HarnessLivenessRecord & { harness?: string }) | null): Promise<void> {
  if (!rec) throw new ResourceConflict(`refusing to stop ${id}: no readable session record proves the adapter or leaf owner`)
  const blocker = await sessionStopBlocker(id, rec.harness || null)
  if (blocker) throw new ResourceConflict(`refusing to stop ${id}: ${blocker}`)
}

export function formatResourceReport(report: ResourceReport): string {
  const host = report.available
    ? `host memory ${report.host.memoryUsedMiB}/${report.host.memoryTotalMiB} MiB, swap ${report.host.swapUsedMiB}/${report.host.swapTotalMiB} MiB`
    : `host metrics unavailable: ${report.unavailableReason}`
  const lines = [`resources @ ${report.measuredAt}`, `  ${host}`, `  attributed PSS ${report.totals.pssMiB ?? 'unavailable'} MiB (RSS ${report.totals.rssMiB} MiB), findings ${report.findings}`]
  for (const owner of report.owners) {
    const lifecycle = owner.status ? ` state=${owner.status}/${owner.proposal ?? '-'} branch=${owner.branch ?? '-'}` : ''
    const refs = owner.references
      ? ` refs=${owner.controlPlane?.refCount ?? '?'}/${owner.references.length} active=${owner.references.filter((r) => r.turnPresence === 'active').length} unknown=${owner.references.filter((r) => r.turnPresence === 'unknown').length}`
      : ''
    lines.push(`  ${owner.kind.padEnd(14)} ${owner.id}  rss=${owner.rssMiB}MiB pss=${owner.pssMiB ?? '?'}MiB cpu=${owner.cpuPercent}%${lifecycle}${refs}${owner.findings.length ? `  ! ${owner.findings.join(',')}` : ''}`)
  }
  return lines.join('\n')
}

let monitorStarted = false
export function startResourceMonitor(): void {
  if (monitorStarted) return
  monitorStarted = true
  const interval = resourceBudgets().reportIntervalMs
  let last = new Set<string>()
  let running = false
  const sample = async () => {
    if (running) return
    running = true
    try {
      const report = await collectResourceReport()
      const stableFinding = (finding: string) => finding.startsWith('rss-over-budget:') ? 'rss-over-budget'
        : finding.startsWith('idle-cpu-over-budget:') ? 'idle-cpu-over-budget'
          : finding
      const next = new Set(report.owners.flatMap((owner) => owner.findings.map((finding) => `${owner.kind}:${owner.id}:${stableFinding(finding)}`)))
      for (const finding of next) if (!last.has(finding)) console.warn(`[resources] entered ${finding}`)
      for (const finding of last) if (!next.has(finding)) console.warn(`[resources] cleared ${finding}`)
      last = next
    } catch (e) { console.error(`[resources] sample failed: ${(e as Error).message}`) }
    finally { running = false }
  }
  setTimeout(() => void sample(), 5000).unref()
  setInterval(() => void sample(), interval).unref()
}
