import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Identity = { pid: number; startToken: string }
type ProcessReading = Identity | null | 'ambiguous'
type Capability =
  | { op: 'stop'; sessionId: string }
  | { op: 'resume'; sessionId: string; force: boolean }

type Authorization = { token: string; epoch: number }
type Operation =
  | { op: 'create' }
  | { op: 'fallback-create' }
  | { op: 'lifecycle-transition'; sessionId: string }
  | { op: 'hook-state'; sessionId: string }
  | { op: 'send'; sessionId: string }
  | { op: 'raw-key-input'; sessionId: string }
  | { op: 'terminal-input'; sessionId: string }
  | { op: 'interrupt'; sessionId: string }
  | { op: 'rename'; sessionId: string }
  | { op: 'sort'; sessionId: string }
  | ({ op: 'stop'; sessionId: string } & Partial<{ authorization: Authorization }>)
  | ({ op: 'resume'; sessionId: string; force: boolean } & Partial<{ authorization: Authorization }>)
  | { op: 'archive'; sessionId: string }
  | { op: 'close'; sessionId: string }
  | { op: 'merge-dispatch'; sessionId: string }
  | { op: 'queue-drain' }
  | { op: 'attach'; sessionId: string }
  | { op: 'shared-spawn'; sessionId: string; delegate: string }

type Ticket = {
  id: string
  epoch: number
  delegateSharedSpawn(sessionId: string): string
}
type Lease = { token: string; epoch: number; state: 'draining' | 'active' }
type Maintenance = {
  headerName: string
  runOperation<T>(operation: Operation, body: (ticket: Ticket) => Promise<T> | T): Promise<T>
  acquireLease(input: { capabilities: readonly Capability[]; owner: Identity; ttlMs: number; waitMs: number }): Promise<Lease>
  heartbeatLease(input: { token: string; epoch: number; ttlMs: number }): Promise<void>
  releaseLease(input: { token: string; epoch: number }): Promise<void>
  readState(): {
    state: 'open' | 'draining' | 'active'
    epoch: number
    tickets: readonly { operation: Operation['op']; owner: Identity }[]
    capabilities: readonly { capability: Capability; state: 'unused' | 'running' | 'completed' | 'indeterminate' }[]
  }
  authorizeHttpOperation(input: {
    authenticated: boolean
    projectMatches: boolean
    headers: Record<string, string>
    operation: Operation
  }): Promise<void>
}
type MaintenanceModule = {
  createSessionMaintenance(input: {
    runtimeRoot: string
    now: () => number
    randomBytes: (size: number) => Buffer
    processIdentity: (pid: number) => ProcessReading
    selfIdentity: () => Identity
    ticketReportMs: number
    onEvent?: (event: Record<string, unknown>) => void
  }): Maintenance
}

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

const expectCode = async (promise: Promise<unknown>, code: string) => {
  await assert.rejects(promise, (error: any) => {
    assert.equal(error?.code, code)
    assert.equal(JSON.stringify(error).includes('5a'.repeat(32)), false)
    return true
  })
}

test('aggregate future maintenance coordinator contract', async (t) => {
  // This is the sole missing-interface red. The integration suite below imports only existing product seams,
  // so wiring cannot become green merely because this standalone module exists.
  const { createSessionMaintenance } = await import('./session-maintenance.js') as MaintenanceModule

  const makeFixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-contract-a-'))
    let now = 10_000
    const readings = new Map<number, ProcessReading>([
      [7001, { pid: 7001, startToken: 'lease-owner-a' }],
      [8001, { pid: 8001, startToken: 'ticket-owner-a' }],
      [8002, { pid: 8002, startToken: 'ticket-owner-b' }],
    ])
    const events: Record<string, unknown>[] = []
    let tokenByte = 0x5a
    let self = readings.get(8001) as Identity
    const create = () => createSessionMaintenance({
      runtimeRoot: root,
      now: () => now,
      randomBytes: (size) => Buffer.alloc(size, tokenByte++),
      processIdentity: (pid) => readings.get(pid) ?? null,
      selfIdentity: () => self,
      ticketReportMs: 1_000,
      onEvent: (event) => events.push(event),
    })
    return {
      root, readings, events, create,
      setSelf(identity: Identity) { self = identity },
      advance(ms: number) { now += ms },
      cleanup() { rmSync(root, { recursive: true, force: true }) },
    }
  }

  await t.test('shared-root CAS closes admission before census and copies capabilities immutably', async () => {
    const f = makeFixture()
    try {
      const a = f.create(); const b = f.create()
      const entered = deferred(); const finish = deferred()
      const old = a.runOperation({ op: 'send', sessionId: 's-1' }, async () => {
        entered.resolve(); await finish.promise
      })
      await entered.promise
      const caps: Capability[] = [{ op: 'stop', sessionId: 's-1' }]
      const pending = b.acquireLease({ capabilities: caps, owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 10_000 })
      await turn()
      caps[0] = { op: 'stop', sessionId: 'forged-after-acquire' }
      await expectCode(a.runOperation({ op: 'create' }, async () => assert.fail('create callback ran')), 'maintenance_active')
      assert.equal(b.readState().state, 'draining')
      finish.resolve(); await old
      const lease = await pending
      assert.equal(lease.state, 'active')
      assert.deepEqual(b.readState().capabilities.map((entry) => entry.capability), [{ op: 'stop', sessionId: 's-1' }])

      const otherRoot = mkdtempSync(join(tmpdir(), 'spex-maintenance-cas-a-'))
      try {
        const make = () => createSessionMaintenance({
          runtimeRoot: otherRoot, now: () => 20_000, randomBytes: (size) => Buffer.alloc(size, Math.floor(Math.random() * 255)),
          processIdentity: (pid) => pid === 7001 ? { pid, startToken: 'lease-owner-a' } : null,
          selfIdentity: () => ({ pid: 8001, startToken: 'ticket-owner-a' }), ticketReportMs: 1_000,
        })
        const winners = await Promise.allSettled([
          make().acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 }),
          make().acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 }),
        ])
        assert.equal(winners.filter((result) => result.status === 'fulfilled').length, 1)
        assert.equal(winners.filter((result) => result.status === 'rejected').length, 1)
      } finally { rmSync(otherRoot, { recursive: true, force: true }) }
    } finally { f.cleanup() }
  })

  await t.test('ticket deadline reports only; live or ambiguous owners block, dead/reused owners reclaim', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const entered = deferred(); const finish = deferred()
      const live = gate.runOperation({ op: 'send', sessionId: 's-live' }, async () => {
        entered.resolve(); await finish.promise
      })
      await entered.promise
      f.advance(60_000)
      const draining = await f.create().acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.equal(draining.state, 'draining', 'deadline cannot prove a live callback stopped')
      f.readings.set(8001, 'ambiguous')
      assert.equal(f.create().readState().state, 'draining', 'ambiguous exact owner remains a blocker')
      f.readings.set(8001, { pid: 8001, startToken: 'pid-reused' })
      assert.equal(f.create().readState().state, 'active', 'start-token reuse is positive reclaim proof')
      finish.resolve(); await live

      await f.create().releaseLease({ token: draining.token, epoch: draining.epoch })
      const thrown = f.create().runOperation({ op: 'send', sessionId: 'throws' }, async () => { throw new Error('callback failed') })
      await assert.rejects(thrown, /callback failed/)
      assert.equal(f.create().readState().tickets.length, 0, 'callback throw releases its ticket in finally')

      f.setSelf({ pid: 8002, startToken: 'ticket-owner-b' })
      const deadEntered = deferred()
      void f.create().runOperation({ op: 'send', sessionId: 'dead-owner' }, async () => {
        deadEntered.resolve(); await new Promise(() => {})
      })
      await deadEntered.promise
      f.readings.delete(8002)
      const afterDeath = await f.create().acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.equal(afterDeath.state, 'active', 'only positive owner death reclaims this unresolved ticket')
      await f.create().releaseLease({ token: afterDeath.token, epoch: afterDeath.epoch })
    } finally { f.cleanup() }
  })

  await t.test('lease expiry or owner crash never reopens until every live ticket drains', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      await expectCode(gate.acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 4_999, waitMs: 0 }), 'maintenance_invalid')
      await expectCode(gate.acquireLease({ capabilities: [], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 300_001, waitMs: 0 }), 'maintenance_invalid')
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 5_000, waitMs: 0,
      })
      const entered = deferred(); const finish = deferred()
      const stopping = gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: { token: lease.token, epoch: lease.epoch } }, async () => {
        entered.resolve(); await finish.promise
      })
      await entered.promise
      f.readings.delete(7001)
      f.advance(5_001)
      const recovered = f.create()
      assert.equal(recovered.readState().state, 'draining')
      await expectCode(recovered.releaseLease({ token: lease.token, epoch: lease.epoch }), 'maintenance_tickets_live')
      await expectCode(recovered.runOperation({ op: 'send', sessionId: 's-1' }, async () => {}), 'maintenance_active')
      finish.resolve(); await stopping
      assert.equal(f.create().readState().state, 'open')
    } finally { f.cleanup() }
  })

  await t.test('token hash, constant-shape negatives, monotonic epoch, and one-shot capability state', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      assert.equal(gate.headerName.toLowerCase(), 'x-spexcode-session-maintenance')
      assert.match(lease.token, /^[0-9a-f]{64}$/)
      const raw = readFileSync(join(f.root, 'session-maintenance.json'), 'utf8')
      const durable = JSON.parse(raw)
      assert.equal(durable.tokenHash, createHash('sha256').update(lease.token).digest('hex'))
      assert.doesNotMatch(raw, new RegExp(lease.token))
      assert.doesNotMatch(JSON.stringify(f.events), new RegExp(lease.token))

      for (const headers of [{}, { [gate.headerName]: 'wrong' }, { [gate.headerName]: '00'.repeat(32) }]) {
        await expectCode(gate.authorizeHttpOperation({
          authenticated: true, projectMatches: true, headers,
          operation: { op: 'stop', sessionId: 's-1' },
        }), 'maintenance_token_invalid')
      }
      await expectCode(gate.authorizeHttpOperation({
        authenticated: false, projectMatches: true, headers: { [gate.headerName]: lease.token }, operation: { op: 'stop', sessionId: 's-1' },
      }), 'unauthorized')
      await expectCode(gate.authorizeHttpOperation({
        authenticated: true, projectMatches: false, headers: { [gate.headerName]: lease.token }, operation: { op: 'stop', sessionId: 's-1' },
      }), 'project_mismatch')

      await gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: { token: lease.token, epoch: lease.epoch } }, async () => {})
      await expectCode(gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: { token: lease.token, epoch: lease.epoch } }, async () => {}), 'maintenance_capability_used')
      await gate.releaseLease({ token: lease.token, epoch: lease.epoch })
      const next = await gate.acquireLease({ capabilities: [{ op: 'stop', sessionId: 'throws' }], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.ok(next.epoch > lease.epoch)
      await expectCode(gate.heartbeatLease({ token: lease.token, epoch: lease.epoch, ttlMs: 30_000 }), 'maintenance_conflict')
      await expectCode(gate.authorizeHttpOperation({
        authenticated: true, projectMatches: true, headers: { [gate.headerName]: lease.token }, operation: { op: 'stop', sessionId: 'throws' },
      }), 'maintenance_token_invalid')
      const callbackThrow = gate.runOperation({ op: 'stop', sessionId: 'throws', authorization: { token: next.token, epoch: next.epoch } }, async () => {
        throw new Error('unknown-after-callback-entry')
      })
      await assert.rejects(callbackThrow, /unknown-after-callback-entry/)
      assert.equal(gate.readState().tickets.length, 0)
      assert.equal(gate.readState().capabilities[0]?.state, 'indeterminate')
      await expectCode(gate.runOperation({ op: 'stop', sessionId: 'throws', authorization: { token: next.token, epoch: next.epoch } }, async () => {}), 'maintenance_capability_used')
      assert.equal('forceBreakLease' in gate, false)
      assert.equal(JSON.stringify(gate.readState()).includes(lease.token), false, 'tickets/status never contain bearer material')
    } finally { f.cleanup() }
  })

  await t.test('resume delegate is opaque, live-parent-bound, one-use, and identity exact', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'resume', sessionId: 's-1', force: true }], owner: { pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      let delegate = ''
      await gate.runOperation({ op: 'resume', sessionId: 's-1', force: true, authorization: { token: lease.token, epoch: lease.epoch } }, async (ticket) => {
        delegate = ticket.delegateSharedSpawn('s-1')
        assert.match(delegate, /^[0-9a-f]{64}$/)
        await gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate }, async () => {})
        await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate }, async () => {}), 'maintenance_delegate_invalid')
        await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 'wrong', delegate }, async () => {}), 'maintenance_delegate_invalid')
        await expectCode(gate.runOperation({ op: 'send', sessionId: 's-1', delegate } as unknown as Operation, async () => {}), 'maintenance_delegate_invalid')
        await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate: 'ff'.repeat(32) }, async () => {}), 'maintenance_delegate_invalid')
      })
      await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate }, async () => {}), 'maintenance_delegate_invalid')
      assert.equal(JSON.stringify(gate.readState()).includes(delegate), false)
      assert.equal(JSON.stringify(f.events).includes(delegate), false)
    } finally { f.cleanup() }
  })
})
