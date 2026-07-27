import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { Duplex, Readable, Writable } from 'node:stream'
import type { Capability, LeaseOwner, MaintenanceState } from './session-maintenance.js'
import { processStartToken } from './process-identity.js'
import {
  clientMaintenanceAcquire,
  clientMaintenanceHeartbeat,
  clientMaintenanceOperation,
  clientMaintenanceRelease,
  clientMaintenanceStatus,
} from './client.js'

type BrokerRequest = {
  v?: number
  id?: string
  op?: string
  sessionId?: string
  force?: boolean
  client?: { pid?: number; startToken?: string }
}
type PlannedCapability = {
  capability: Capability
  state: 'unused' | 'inflight' | 'committed' | 'indeterminate'
  requestId?: string
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const capabilityKey = (capability: Capability): string => JSON.stringify(capability)
const capabilityList = (rows: unknown): Capability[] => Array.isArray(rows)
  ? rows.map((row: any) => row?.capability ?? row)
  : []
const sameCapabilities = (left: readonly Capability[], right: readonly Capability[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right)
const sameOwner = (left: LeaseOwner | null | undefined, right: LeaseOwner): boolean =>
  !!left && left.instanceId === right.instanceId && left.pid === right.pid && left.startToken === right.startToken
const assertLeaseView = (view: Pick<MaintenanceState, 'state' | 'epoch' | 'owner' | 'capabilities'>, epoch: number, owner: LeaseOwner, capabilities: readonly Capability[], allowDraining = false) => {
  if (view.epoch !== epoch || (!allowDraining && view.state !== 'active') || (allowDraining && view.state !== 'active' && view.state !== 'draining'))
    throw new Error('maintenance lease changed epoch or state')
  if (!sameOwner(view.owner, owner)) throw new Error('maintenance lease owner generation changed')
  if (!sameCapabilities(capabilityList(view.capabilities), capabilities)) throw new Error('maintenance lease changed its capability plan')
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const reapCommandGroup = async (child: ReturnType<typeof spawn>, closed: Promise<[number | null, NodeJS.Signals | null]>) => {
  if (!child.pid) return
  const groupAlive = () => {
    try { process.kill(-child.pid!, 0); return true } catch { return false }
  }
  if (groupAlive()) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
    const deadline = Date.now() + 1_000
    while (groupAlive() && Date.now() < deadline) await wait(20)
    if (groupAlive()) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
  }
  if (child.exitCode === null && child.signalCode === null) await closed
}

export async function runMaintenanceWrapper(input: {
  capabilities: Capability[]
  ttlMs: number
  waitMs: number
  command: string[]
}): Promise<number> {
  const acquired = await clientMaintenanceAcquire(input.capabilities, input.ttlMs, input.waitMs)
  const { token, epoch, owner } = acquired.lease
  if (!token || !/^[0-9a-f]{64}$/i.test(token) || !Number.isSafeInteger(epoch)) throw new Error('maintenance acquire returned malformed private authority')
  if (!owner || typeof owner.instanceId !== 'string' || !Number.isInteger(owner.pid) || typeof owner.startToken !== 'string')
    throw new Error('maintenance acquire returned malformed supervisor authority')
  if (!sameCapabilities(capabilityList(acquired.lease.capabilities), input.capabilities)) throw new Error('maintenance acquire returned a different capability plan')

  let state = acquired.lease.state
  const activationDeadline = Date.now() + input.ttlMs
  while (state === 'draining') {
    const heartbeat = await clientMaintenanceHeartbeat(token, epoch, input.ttlMs)
    assertLeaseView(heartbeat, epoch, owner, input.capabilities, true)
    const status = await clientMaintenanceStatus()
    assertLeaseView(status, epoch, owner, input.capabilities, true)
    state = status.state as 'draining' | 'active'
    if (state !== 'active') {
      if (Date.now() >= activationDeadline) throw new Error('maintenance acquisition did not become active before its ttl')
      await sleep(50)
    }
  }
  if (state !== 'active') throw new Error(`maintenance acquisition entered unexpected state ${state}`)
  if (!input.command.length) throw new Error('maintenance wrapper needs a command after --')

  const plan: PlannedCapability[] = input.capabilities.map((capability) => ({ capability: { ...capability }, state: 'unused' }))
  let released = false
  let authorityLost = false
  let heartbeatFailure: Error | null = null
  let heartbeatBusy = false
  let failAuthority!: (error: Error) => void
  const authorityFailure = new Promise<never>((_, reject) => {
    failAuthority = (error) => {
      if (heartbeatFailure) return
      heartbeatFailure = error
      reject(error)
    }
  })
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || heartbeatFailure) return
    heartbeatBusy = true
    void clientMaintenanceHeartbeat(token, epoch, input.ttlMs)
      .then((current) => assertLeaseView(current, epoch, owner, input.capabilities))
      .catch((error) => failAuthority(error instanceof Error ? error : new Error(String(error))))
      .finally(() => { heartbeatBusy = false })
  }, Math.max(250, Math.min(1_000, Math.floor(input.ttlMs / 3))))
  heartbeat.unref()

  let child: ReturnType<typeof spawn> | null = null
  let closeAdmission = () => {}
  try {
    child = spawn(input.command[0], input.command.slice(1), {
      stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, SPEXCODE_MAINTENANCE_BROKER_FDS: '3,4,5' },
      detached: true,
    })
    const closed = once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>
    const childStdio = child.stdio as Array<Readable | Writable | Duplex | null | undefined>
    const requestPipe = childStdio[3] as Readable
    const responsePipe = childStdio[4] as Writable
    const turnPipe = childStdio[5] as Duplex
    requestPipe.setEncoding('utf8')
    let pending = ''
    let serial = Promise.resolve()
    let brokerOpen = true
    let transportLossTimer: ReturnType<typeof setTimeout> | null = null
    const brokerTransportLost = (error: unknown) => {
      if (!brokerOpen || transportLossTimer) return
      transportLossTimer = setTimeout(() => {
        transportLossTimer = null
        if (brokerOpen && child?.exitCode === null && child.signalCode === null) {
          failAuthority(error instanceof Error ? error : new Error('maintenance broker transport closed while the operator command was live'))
        }
      }, 50)
      transportLossTimer.unref()
    }
    requestPipe.on('error', brokerTransportLost)
    requestPipe.on('end', () => brokerTransportLost(new Error('maintenance broker request pipe closed while the operator command was live')))
    responsePipe.on('error', brokerTransportLost)
    responsePipe.on('close', () => brokerTransportLost(new Error('maintenance broker response pipe closed while the operator command was live')))
    turnPipe.on('error', brokerTransportLost)
    turnPipe.on('end', () => brokerTransportLost(new Error('maintenance broker turn pipe closed while the operator command was live')))
    closeAdmission = () => {
      if (!brokerOpen) return
      brokerOpen = false
      if (transportLossTimer) clearTimeout(transportLossTimer)
      transportLossTimer = null
      try { requestPipe.destroy() } catch { /* already closed */ }
      try { turnPipe.destroy() } catch { /* already closed */ }
    }
    turnPipe.on('data', (chunk: Buffer) => {
      if (!brokerOpen) return
      for (const byte of chunk) {
        if (byte !== 1) return failAuthority(new Error('maintenance broker turn token was corrupted'))
        turnPipe.write(Buffer.from([1]))
      }
    })
    turnPipe.write(Buffer.from([1]))
    const reply = (id: string | undefined, body: Record<string, unknown>) => {
      if (brokerOpen) responsePipe.write(`${JSON.stringify({ id, ...body })}\n`)
    }
    const handle = async (request: BrokerRequest) => {
      if (!brokerOpen) return
      if (request.v !== 1 || typeof request.id !== 'string' || typeof request.op !== 'string' || typeof request.sessionId !== 'string'
        || !Number.isInteger(request.client?.pid) || typeof request.client?.startToken !== 'string'
        || processStartToken(request.client.pid!) !== request.client.startToken) {
        reply(request.id, { ok: false, code: 'maintenance_invalid', error: 'malformed broker request' })
        return
      }
      const candidate: Capability | null = request.op === 'stop'
        ? { op: 'stop', sessionId: request.sessionId }
        : request.op === 'resume' && typeof request.force === 'boolean'
          ? { op: 'resume', sessionId: request.sessionId, force: request.force }
          : null
      const matching = candidate && plan.find((entry) => capabilityKey(entry.capability) === capabilityKey(candidate))
      const planned = matching?.state === 'unused' ? matching : null
      if (!planned) {
        reply(request.id, {
          ok: false,
          code: matching ? 'maintenance_capability_used' : 'maintenance_capability_missing',
          error: matching ? 'operation is already inflight, committed, or indeterminate' : 'operation is not in the exact maintenance plan',
        })
        return
      }
      planned.state = 'inflight'
      planned.requestId = request.id
      try {
        const result = await clientMaintenanceOperation(token, candidate!)
        const committed = result.ok && result.body?.ok === true
        const retryable = (!result.ok && (result.status ?? 0) >= 400 && (result.status ?? 0) < 500 && typeof result.code === 'string')
          || (result.ok && result.body?.ok === false)
        planned.state = committed ? 'committed' : retryable ? 'unused' : 'indeterminate'
        delete planned.requestId
        reply(request.id, result)
      } catch (error) {
        planned.state = 'indeterminate'
        delete planned.requestId
        reply(request.id, { ok: false, code: 'maintenance_broker_failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    requestPipe.on('data', (chunk: Buffer | string) => {
      pending += chunk.toString()
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline < 0) break
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        if (!line) continue
        serial = serial.then(async () => {
          try { await handle(JSON.parse(line) as BrokerRequest) }
          catch (error) { reply(undefined, { ok: false, code: 'maintenance_broker_failed', error: error instanceof Error ? error.message : String(error) }) }
        })
      }
    })
    const outcome = await Promise.race([
      closed.then(([code, signal]) => ({ kind: 'exit' as const, code, signal })),
      authorityFailure.catch((error) => ({ kind: 'lost' as const, error: error instanceof Error ? error : new Error(String(error)) })),
    ])
    if (outcome.kind === 'lost') {
      authorityLost = true
      closeAdmission()
      await reapCommandGroup(child, closed)
      throw outcome.error
    }
    closeAdmission()
    await serial
    await reapCommandGroup(child, closed)
    if (heartbeatFailure) {
      authorityLost = true
      throw heartbeatFailure
    }
    return outcome.code ?? (outcome.signal ? 1 : 0)
  } finally {
    clearInterval(heartbeat)
    closeAdmission()
    try { child?.stdio[3]?.destroy() } catch { /* child already closed */ }
    try { child?.stdio[4]?.destroy() } catch { /* child already closed */ }
    try { (child?.stdio as Array<Readable | Writable | null | undefined> | undefined)?.[5]?.destroy() } catch { /* child already closed */ }
    if (!released && !authorityLost) {
      await clientMaintenanceRelease(token, epoch)
      released = true
    }
  }
}
