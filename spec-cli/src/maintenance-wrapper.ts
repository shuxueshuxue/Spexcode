import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { Readable, Writable } from 'node:stream'
import type { Capability } from './session-maintenance.js'
import {
  clientMaintenanceAcquire,
  clientMaintenanceHeartbeat,
  clientMaintenanceOperation,
  clientMaintenanceRelease,
  clientMaintenanceStatus,
} from './client.js'

type BrokerRequest = { v?: number; id?: string; op?: string; sessionId?: string; force?: boolean }
type PlannedCapability = { capability: Capability; used: boolean }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const capabilityKey = (capability: Capability): string => JSON.stringify(capability)
const capabilityList = (rows: unknown): Capability[] => Array.isArray(rows)
  ? rows.map((row: any) => row?.capability ?? row)
  : []
const sameCapabilities = (left: readonly Capability[], right: readonly Capability[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export async function runMaintenanceWrapper(input: {
  capabilities: Capability[]
  ttlMs: number
  waitMs: number
  command: string[]
}): Promise<number> {
  const acquired = await clientMaintenanceAcquire(input.capabilities, input.ttlMs, input.waitMs)
  const { token, epoch } = acquired.lease
  if (!token || !/^[0-9a-f]{64}$/i.test(token) || !Number.isSafeInteger(epoch)) throw new Error('maintenance acquire returned malformed private authority')
  if (!sameCapabilities(capabilityList(acquired.lease.capabilities), input.capabilities)) throw new Error('maintenance acquire returned a different capability plan')

  let state = acquired.lease.state
  const activationDeadline = Date.now() + input.ttlMs
  while (state === 'draining') {
    await clientMaintenanceHeartbeat(token, epoch, input.ttlMs)
    const status = await clientMaintenanceStatus()
    if (status.epoch !== epoch || status.state === 'open') throw new Error('maintenance acquisition expired or changed epoch before activation')
    if (!sameCapabilities(capabilityList(status.capabilities), input.capabilities)) throw new Error('maintenance status returned a different capability plan')
    state = status.state
    if (state !== 'active') {
      if (Date.now() >= activationDeadline) throw new Error('maintenance acquisition did not become active before its ttl')
      await sleep(50)
    }
  }
  if (state !== 'active') throw new Error(`maintenance acquisition entered unexpected state ${state}`)
  if (!input.command.length) throw new Error('maintenance wrapper needs a command after --')

  const plan: PlannedCapability[] = input.capabilities.map((capability) => ({ capability: { ...capability }, used: false }))
  let released = false
  let heartbeatFailure: Error | null = null
  let heartbeatBusy = false
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || heartbeatFailure) return
    heartbeatBusy = true
    void clientMaintenanceHeartbeat(token, epoch, input.ttlMs)
      .catch((error) => { heartbeatFailure = error instanceof Error ? error : new Error(String(error)) })
      .finally(() => { heartbeatBusy = false })
  }, Math.max(250, Math.min(1_000, Math.floor(input.ttlMs / 3))))
  heartbeat.unref()

  let child: ReturnType<typeof spawn> | null = null
  try {
    child = spawn(input.command[0], input.command.slice(1), {
      stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe'],
      env: { ...process.env, SPEXCODE_MAINTENANCE_BROKER_FDS: '3,4' },
    })
    const requestPipe = child.stdio[3] as Readable
    const responsePipe = child.stdio[4] as Writable
    requestPipe.setEncoding('utf8')
    let pending = ''
    let serial = Promise.resolve()
    const reply = (id: string | undefined, body: Record<string, unknown>) => {
      responsePipe.write(`${JSON.stringify({ id, ...body })}\n`)
    }
    const handle = async (request: BrokerRequest) => {
      if (request.v !== 1 || typeof request.id !== 'string' || typeof request.op !== 'string' || typeof request.sessionId !== 'string') {
        reply(request.id, { ok: false, code: 'maintenance_invalid', error: 'malformed broker request' })
        return
      }
      const candidate: Capability | null = request.op === 'stop'
        ? { op: 'stop', sessionId: request.sessionId }
        : request.op === 'resume' && typeof request.force === 'boolean'
          ? { op: 'resume', sessionId: request.sessionId, force: request.force }
          : null
      const planned = candidate && plan.find((entry) => !entry.used && capabilityKey(entry.capability) === capabilityKey(candidate))
      if (!planned) {
        reply(request.id, { ok: false, code: 'maintenance_capability_missing', error: 'operation is not in the exact maintenance plan' })
        return
      }
      planned.used = true
      const result = await clientMaintenanceOperation(token, candidate)
      reply(request.id, result)
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
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
    await serial
    if (heartbeatFailure) throw heartbeatFailure
    return code ?? (signal ? 1 : 0)
  } finally {
    clearInterval(heartbeat)
    try { child?.stdio[3]?.destroy() } catch { /* child already closed */ }
    try { child?.stdio[4]?.destroy() } catch { /* child already closed */ }
    if (!released) {
      await clientMaintenanceRelease(token, epoch)
      released = true
    }
  }
}
