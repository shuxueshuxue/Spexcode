import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Identity = { pid: number; startToken: string }
type Capability =
  | { op: 'stop'; sessionId: string }
  | { op: 'resume'; sessionId: string; force: boolean }

type Operation = {
  op: string
  sessionId?: string
  force?: boolean
  token?: string
  parentTicketId?: string
}

type Ticket = { id: string; epoch: number }
type Lease = { token: string; epoch: number; state: 'active' }
type Maintenance = {
  headerName: string
  runOperation<T>(operation: Operation, body: (ticket: Ticket) => Promise<T> | T): Promise<T>
  acquireLease(input: { capabilities: Capability[]; owner: Identity; ttlMs: number }): Promise<Lease>
  heartbeatLease(input: { token: string; epoch: number; ttlMs: number }): Promise<void>
  releaseLease(input: { token: string; epoch: number }): Promise<void>
  readState(): { state: 'open' | 'draining' | 'active'; epoch: number }
  authorizeHttpOperation(input: { authenticated: boolean; headers: Record<string, string>; operation: Operation }): Promise<void>
}

type MaintenanceModule = {
  createSessionMaintenance(input: {
    runtimeRoot: string
    now: () => number
    randomBytes: (size: number) => Buffer
    processIdentity: (pid: number) => Identity | null
    selfIdentity: () => Identity
    ticketTtlMs: number
    onEvent?: (event: Record<string, unknown>) => void
  }): Maintenance
}

const loadImplementation = async (): Promise<MaintenanceModule> =>
  await import('./session-maintenance.js') as MaintenanceModule

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-a-'))
  const processes = new Map<number, Identity>([
    [7001, { pid: 7001, startToken: 'owner-a' }],
    [8001, { pid: 8001, startToken: 'ticket-a' }],
  ])
  let now = 10_000
  const events: Record<string, unknown>[] = []
  const { createSessionMaintenance } = await loadImplementation()
  const create = () => createSessionMaintenance({
    runtimeRoot: root,
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, 0x5a),
    processIdentity: (pid) => processes.get(pid) ?? null,
    selfIdentity: () => processes.get(8001)!,
    ticketTtlMs: 1_000,
    onEvent: (event) => events.push(event),
  })
  return {
    root,
    processes,
    events,
    create,
    gate: create(),
    advance(ms: number) { now += ms },
    cleanup() { rmSync(root, { recursive: true, force: true }) },
  }
}

const assertMaintenanceActive = async (promise: Promise<unknown>) => {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error?.code, 'maintenance_active')
    assert.equal(error?.state === 'draining' || error?.state === 'active', true)
    return true
  })
}

test('lease acquisition closes admission atomically before draining existing tickets', async () => {
  const f = await fixture()
  try {
    const entered = deferred()
    const finish = deferred()
    const existing = f.gate.runOperation({ op: 'send', sessionId: 's-1' }, async () => {
      entered.resolve()
      await finish.promise
    })
    await entered.promise
    let acquired = false
    const leasePending = f.gate.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 's-1' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    }).then((lease) => { acquired = true; return lease })

    await assertMaintenanceActive(f.gate.runOperation({ op: 'raw-input', sessionId: 's-1' }, async () => {}))
    assert.equal(f.gate.readState().state, 'draining')
    assert.equal(acquired, false, 'lease waits for the ticket admitted under the preceding epoch')
    finish.resolve()
    await existing
    assert.equal((await leasePending).state, 'active')
  } finally { f.cleanup() }
})

test('restart honors a live lease and reaps only stale ticket PID/start/deadline identities', async () => {
  const f = await fixture()
  try {
    const firstEntered = deferred()
    void f.gate.runOperation({ op: 'send', sessionId: 's-1' }, async () => {
      firstEntered.resolve()
      await new Promise(() => {})
    })
    await firstEntered.promise
    f.processes.set(8001, { pid: 8001, startToken: 'ticket-reused' })
    const afterReuse = f.create()
    const lease = await afterReuse.acquireLease({
      capabilities: [{ op: 'resume', sessionId: 's-1', force: false }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    const restarted = f.create()
    assert.deepEqual(restarted.readState(), { state: 'active', epoch: lease.epoch })
    await assertMaintenanceActive(restarted.runOperation({ op: 'hook-state', sessionId: 's-1' }, async () => {}))
    await restarted.releaseLease({ token: lease.token, epoch: lease.epoch })

    const deadlineEntered = deferred()
    void restarted.runOperation({ op: 'send', sessionId: 's-2' }, async () => {
      deadlineEntered.resolve()
      await new Promise(() => {})
    })
    await deadlineEntered.promise
    f.advance(1_001)
    const afterDeadline = f.create()
    const secondLease = await afterDeadline.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 's-2' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    assert.equal(secondLease.state, 'active', 'a live-PID ticket is stale after its bounded deadline')
    f.processes.delete(7001)
    f.advance(30_001)
    const recovered = f.create()
    assert.equal(recovered.readState().state, 'open')
    await recovered.runOperation({ op: 'send', sessionId: 's-1' }, async () => {})
  } finally { f.cleanup() }
})

test('active maintenance blocks hooks, fallback create, queue drain, and direct shared spawn with zero side effects', async () => {
  const f = await fixture()
  try {
    await f.gate.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 'protected' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    let sideEffects = 0
    for (const op of ['hook-state', 'fallback-create', 'queue-drain', 'shared-spawn']) {
      await assertMaintenanceActive(f.gate.runOperation({ op, sessionId: 'other' }, async () => { sideEffects++ }))
    }
    assert.equal(sideEffects, 0)
  } finally { f.cleanup() }
})

test('finite allowlist admits exact stop and multi-resume capabilities only', async () => {
  const f = await fixture()
  try {
    const lease = await f.gate.acquireLease({
      capabilities: [
        { op: 'stop', sessionId: 's-1' },
        { op: 'resume', sessionId: 's-1', force: false },
        { op: 'resume', sessionId: 's-2', force: true },
      ],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    const ran: string[] = []
    await f.gate.runOperation({ op: 'stop', sessionId: 's-1', token: lease.token }, async () => { ran.push('stop:s-1') })
    await f.gate.runOperation({ op: 'resume', sessionId: 's-1', force: false, token: lease.token }, async () => { ran.push('resume:s-1:false') })
    await f.gate.runOperation({ op: 'resume', sessionId: 's-2', force: true, token: lease.token }, async () => { ran.push('resume:s-2:true') })
    await assertMaintenanceActive(f.gate.runOperation({ op: 'resume', sessionId: 's-2', force: false, token: lease.token }, async () => { ran.push('wrong-force') }))
    await assertMaintenanceActive(f.gate.runOperation({ op: 'stop', sessionId: 's-3', token: lease.token }, async () => { ran.push('wrong-session') }))
    await assertMaintenanceActive(f.gate.runOperation({ op: 'send', sessionId: 's-1', token: lease.token }, async () => { ran.push('send') }))
    assert.deepEqual(ran, ['stop:s-1', 'resume:s-1:false', 'resume:s-2:true'])
  } finally { f.cleanup() }
})

test('token is 256-bit opaque header material and only its hash reaches durable state or events', async () => {
  const f = await fixture()
  try {
    const lease = await f.gate.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 's-1' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    assert.match(lease.token, /^[0-9a-f]{64}$/)
    assert.equal(f.gate.headerName, 'x-spexcode-session-maintenance')
    const durable = readFileSync(join(f.root, 'session-maintenance.json'), 'utf8')
    assert.doesNotMatch(durable, new RegExp(lease.token))
    assert.match(durable, /"tokenHash"\s*:\s*"[0-9a-f]{64}"/)
    assert.doesNotMatch(JSON.stringify(f.events), new RegExp(lease.token))
    await assert.rejects(f.gate.authorizeHttpOperation({
      authenticated: false,
      headers: { [f.gate.headerName]: lease.token },
      operation: { op: 'stop', sessionId: 's-1' },
    }), (error: any) => error?.code === 'unauthorized')
  } finally { f.cleanup() }
})

test('structured maintenance_active refusal runs no callback for any ordinary write', async () => {
  const f = await fixture()
  try {
    await f.gate.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 's-1' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    let touched = false
    await assert.rejects(f.gate.runOperation({ op: 'archive', sessionId: 's-1' }, async () => { touched = true }), (error: any) => {
      assert.deepEqual({ code: error?.code, state: error?.state, op: error?.op, sessionId: error?.sessionId }, {
        code: 'maintenance_active', state: 'active', op: 'archive', sessionId: 's-1',
      })
      return true
    })
    assert.equal(touched, false)
  } finally { f.cleanup() }
})

test('canonical shared spawn is admitted only as a child of an exact resume ticket', async () => {
  const f = await fixture()
  try {
    const lease = await f.gate.acquireLease({
      capabilities: [{ op: 'resume', sessionId: 's-1', force: true }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    let nested = 0
    await f.gate.runOperation({ op: 'resume', sessionId: 's-1', force: true, token: lease.token }, async (resumeTicket) => {
      await f.gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', parentTicketId: resumeTicket.id }, async () => { nested++ })
    })
    await assertMaintenanceActive(f.gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', token: lease.token }, async () => { nested++ }))
    assert.equal(nested, 1)
  } finally { f.cleanup() }
})

test('heartbeat and release use epoch CAS and expose no force-break for a live lease', async () => {
  const f = await fixture()
  try {
    const lease = await f.gate.acquireLease({
      capabilities: [{ op: 'stop', sessionId: 's-1' }],
      owner: { pid: 7001, startToken: 'owner-a' },
      ttlMs: 30_000,
    })
    await assert.rejects(f.gate.heartbeatLease({ token: lease.token, epoch: lease.epoch - 1, ttlMs: 30_000 }), (error: any) => error?.code === 'maintenance_conflict')
    await assert.rejects(f.gate.releaseLease({ token: lease.token, epoch: lease.epoch - 1 }), (error: any) => error?.code === 'maintenance_conflict')
    assert.equal('forceBreakLease' in f.gate, false)
    await f.gate.heartbeatLease({ token: lease.token, epoch: lease.epoch, ttlMs: 30_000 })
    await f.gate.releaseLease({ token: lease.token, epoch: lease.epoch })
    assert.equal(f.gate.readState().state, 'open')
  } finally { f.cleanup() }
})
