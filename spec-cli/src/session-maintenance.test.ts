import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { processStartToken } from './process-identity.js'

const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))
const casFixture = fileURLToPath(new URL('../test/session-maintenance-cas-fixture.ts', import.meta.url))

type Identity = { pid: number; startToken: string }
type LeaseOwner = Identity & { instanceId: string }
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
  | { op: 'shared-spawn'; sessionId: string; delegate?: string }

type Ticket = {
  id: string
  epoch: number
  delegateSharedSpawn(sessionId: string): string
}
type Lease = { token: string; epoch: number; state: 'draining' | 'active'; owner: LeaseOwner; capabilities: readonly Capability[] }
type Maintenance = {
  headerName: string
  runOperation<T>(operation: Operation, body: (ticket: Ticket) => Promise<T> | T): Promise<T>
  acquireLease(input: { capabilities: readonly Capability[]; owner: LeaseOwner; ttlMs: number; waitMs: number }): Promise<Lease>
  heartbeatLease(input: { token: string; epoch: number; ttlMs: number }): Promise<void>
  releaseLease(input: { token: string; epoch: number }): Promise<void>
  readState(): {
    state: 'open' | 'draining' | 'active'
    epoch: number
    owner: LeaseOwner | null
    heartbeatDeadline: number | null
    tickets: readonly { operation: Operation['op']; sessionId?: string; force?: boolean; owner: Identity; deadline: number }[]
    capabilities: readonly { capability: Capability; state: 'unused' | 'inflight' | 'committed' | 'indeterminate'; requestId?: string }[]
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
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const waitUntil = async (check: () => boolean, label: string, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await sleep(5)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const bounded = <T>(promise: Promise<T>, label: string, timeoutMs = 5_000) => Promise.race([
  promise,
  new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs)
    timer.unref()
  }),
])

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
      const pending = b.acquireLease({ capabilities: caps, owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 10_000 })
      await turn()
      caps[0] = { op: 'stop', sessionId: 'forged-after-acquire' }
      await expectCode(a.runOperation({ op: 'create' }, async () => assert.fail('create callback ran')), 'maintenance_active')
      assert.equal(b.readState().state, 'draining')
      finish.resolve(); await old
      const lease = await pending
      assert.equal(lease.state, 'active')
      assert.deepEqual(b.readState().capabilities.map((entry) => entry.capability), [{ op: 'stop', sessionId: 's-1' }])

      const otherRoot = mkdtempSync(join(tmpdir(), 'spex-maintenance-cas-a-'))
      const startBarrier = join(otherRoot, 'start')
      const releaseBarrier = join(otherRoot, 'release')
      const ready = join(otherRoot, 'ready')
      const resultsDir = join(otherRoot, 'results')
      mkdirSync(ready); mkdirSync(resultsDir)
      const children = [0x31, 0x32].map((byte) => {
        const child = spawn(tsx, [casFixture, otherRoot, startBarrier, releaseBarrier, ready, resultsDir, String(byte)], {
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''; let stderr = ''
        child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
        child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
        const closed = (once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>).then(([code, signal]) => ({ code, signal, stdout, stderr }))
        return { child, closed }
      })
      try {
        await waitUntil(() => readdirSync(ready).length === 2, 'both CAS children ready')
        assert.equal(readdirSync(ready).length, 2, 'both independent processes reached the same-root CAS barrier')
        writeFileSync(startBarrier, '')
        await waitUntil(() => readdirSync(resultsDir).length === 2, 'both CAS children report')
        const results = readdirSync(resultsDir).map((name) => JSON.parse(readFileSync(join(resultsDir, name), 'utf8')) as { pid: number; ok: boolean; code?: string })
        assert.equal(results.filter((result) => result.ok).length, 1)
        assert.deepEqual(results.filter((result) => !result.ok).map((result) => result.code), ['maintenance_conflict'])
        const winner = results.find((result) => result.ok)
        assert.ok(winner)
        assert.ok(processStartToken(winner.pid), 'exact winning lease-owner process remains alive through loser report')
        writeFileSync(releaseBarrier, '')
        const exits = await Promise.all(children.map(({ closed }, index) => bounded(closed, `CAS child ${index} exit`)))
        for (const result of exits) assert.equal(result.code, 0, result.stderr)
      } finally {
        if (!existsSync(startBarrier)) writeFileSync(startBarrier, '')
        if (!existsSync(releaseBarrier)) writeFileSync(releaseBarrier, '')
        for (const { child } of children) {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        }
        await Promise.all(children.map(({ closed }, index) => bounded(closed, `CAS child ${index} teardown`, 1_000).catch(() => null)))
        for (const { child } of children) {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }
        await Promise.all(children.map(({ closed }, index) => bounded(closed, `CAS child ${index} forced teardown`, 1_000).catch(() => null)))
        rmSync(otherRoot, { recursive: true, force: true })
      }
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
      const draining = await f.create().acquireLease({ capabilities: [], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.equal(draining.state, 'draining', 'deadline cannot prove a live callback stopped')
      assert.deepEqual(f.create().readState(), {
        state: 'draining', epoch: draining.epoch,
        owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' },
        heartbeatDeadline: 100_000,
        tickets: [{ operation: 'send', sessionId: 's-live', owner: { pid: 8001, startToken: 'ticket-owner-a' }, deadline: 11_000 }],
        capabilities: [],
      }, 'status exposes deadlines and exact owners without secret ticket or bearer material')
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
      const afterDeath = await f.create().acquireLease({ capabilities: [], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.equal(afterDeath.state, 'active', 'only positive owner death reclaims this unresolved ticket')
      await f.create().releaseLease({ token: afterDeath.token, epoch: afterDeath.epoch })
    } finally { f.cleanup() }
  })

  await t.test('lease expiry or owner crash never reopens until every live ticket drains', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      await expectCode(gate.acquireLease({ capabilities: [], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 4_999, waitMs: 0 }), 'maintenance_invalid')
      await expectCode(gate.acquireLease({ capabilities: [], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 300_001, waitMs: 0 }), 'maintenance_invalid')
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 5_000, waitMs: 0,
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
      await expectCode(recovered.releaseLease({ token: lease.token, epoch: lease.epoch }), 'maintenance_token_invalid')
      await expectCode(recovered.runOperation({ op: 'send', sessionId: 's-1' }, async () => {}), 'maintenance_active')
      finish.resolve(); await stopping
      assert.equal(f.create().readState().state, 'open')
    } finally { f.cleanup() }
  })

  await t.test('exact stop and multi-resume capabilities admit positives and reject duplicate/session/op/force mismatches without state change', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const initial = JSON.stringify({ state: gate.readState(), events: f.events })
      await expectCode(gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }, { op: 'stop', sessionId: 's-1' }],
        owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      }), 'maintenance_invalid')
      assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), initial, 'duplicate capability refusal changes nothing')

      const lease = await gate.acquireLease({
        capabilities: [
          { op: 'stop', sessionId: 's-1' },
          { op: 'resume', sessionId: 's-1', force: false },
          { op: 'resume', sessionId: 's-2', force: true },
        ],
        owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      const auth = { token: lease.token, epoch: lease.epoch }
      const beforeAuthorize = JSON.stringify({ state: gate.readState(), events: f.events })
      await gate.authorizeHttpOperation({
        authenticated: true, projectMatches: true, headers: { [gate.headerName]: lease.token },
        operation: { op: 'stop', sessionId: 's-1' },
      })
      assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), beforeAuthorize, 'legal HTTP authorization is a pure check')

      for (const operation of [
        { op: 'stop', sessionId: 'wrong', authorization: auth },
        { op: 'resume', sessionId: 's-2', force: false, authorization: auth },
        { op: 'send', sessionId: 's-1', authorization: auth },
      ] as unknown as Operation[]) {
        const before = JSON.stringify({ state: gate.readState(), events: f.events })
        await expectCode(gate.runOperation(operation, async () => assert.fail('mismatched capability callback ran')), 'maintenance_capability_missing')
        assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), before)
      }

      const effects: string[] = []
      await gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: auth }, async () => { effects.push('stop:s-1') })
      await gate.runOperation({ op: 'resume', sessionId: 's-1', force: false, authorization: auth }, async () => { effects.push('resume:s-1:false') })
      await gate.runOperation({ op: 'resume', sessionId: 's-2', force: true, authorization: auth }, async () => { effects.push('resume:s-2:true') })
      assert.deepEqual(effects, ['stop:s-1', 'resume:s-1:false', 'resume:s-2:true'])
    } finally { f.cleanup() }
  })

  await t.test('valid heartbeat preserves the active epoch and extends its exact durable deadline', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      f.advance(1_000)
      await gate.heartbeatLease({ token: lease.token, epoch: lease.epoch, ttlMs: 60_000 })
      assert.equal(gate.readState().state, 'active')
      assert.equal(gate.readState().epoch, lease.epoch)
      assert.equal(JSON.parse(readFileSync(join(f.root, 'session-maintenance.json'), 'utf8')).heartbeatDeadline, 71_000)
    } finally { f.cleanup() }
  })

  await t.test('token hash, constant-shape negatives, monotonic epoch, and one-shot capability state', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      assert.equal(gate.headerName.toLowerCase(), 'x-spexcode-session-maintenance')
      assert.match(lease.token, /^[0-9a-f]{64}$/)
      const raw = readFileSync(join(f.root, 'session-maintenance.json'), 'utf8')
      const durable = JSON.parse(raw)
      assert.equal(durable.tokenHash, createHash('sha256').update(lease.token).digest('hex'))
      assert.doesNotMatch(raw, new RegExp(lease.token))
      assert.doesNotMatch(JSON.stringify(f.events), new RegExp(lease.token))

      const negatives = [
        { authenticated: false, projectMatches: false, headers: {}, code: 'unauthorized' },
        { authenticated: true, projectMatches: false, headers: {}, code: 'project_mismatch' },
        { authenticated: true, projectMatches: true, headers: {}, code: 'maintenance_token_invalid' },
        { authenticated: true, projectMatches: true, headers: { [gate.headerName]: 'wrong' }, code: 'maintenance_token_invalid' },
        { authenticated: true, projectMatches: true, headers: { [gate.headerName]: '00'.repeat(32) }, code: 'maintenance_token_invalid' },
      ]
      for (const attempt of negatives) {
        const before = JSON.stringify({ state: gate.readState(), events: f.events })
        await expectCode(gate.authorizeHttpOperation({
          authenticated: attempt.authenticated, projectMatches: attempt.projectMatches, headers: attempt.headers,
          operation: { op: 'stop', sessionId: 's-1' },
        }), attempt.code)
        assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), before, `${attempt.code} refusal changes no state/event`)
      }

      await gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: { token: lease.token, epoch: lease.epoch } }, async () => {})
      await expectCode(gate.runOperation({ op: 'stop', sessionId: 's-1', authorization: { token: lease.token, epoch: lease.epoch } }, async () => {}), 'maintenance_capability_used')
      await gate.releaseLease({ token: lease.token, epoch: lease.epoch })
      const next = await gate.acquireLease({ capabilities: [{ op: 'stop', sessionId: 'throws' }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0 })
      assert.ok(next.epoch > lease.epoch)
      await expectCode(gate.heartbeatLease({ token: lease.token, epoch: lease.epoch, ttlMs: 30_000 }), 'maintenance_conflict')
      const beforeStale = JSON.stringify({ state: gate.readState(), events: f.events })
      await expectCode(gate.authorizeHttpOperation({
        authenticated: true, projectMatches: true, headers: { [gate.headerName]: lease.token }, operation: { op: 'stop', sessionId: 'throws' },
      }), 'maintenance_token_invalid')
      assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), beforeStale, 'stale token changes no state/event')
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
        capabilities: [{ op: 'resume', sessionId: 's-1', force: true }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
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

  await t.test('consumed shared-spawn delegate does not complete its parent resume ticket before launch readiness', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'resume', sessionId: 's-1', force: true }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      let releaseReady!: () => void
      const ready = new Promise<void>((resolve) => { releaseReady = resolve })
      let helperConsumed = false
      let readinessEntered = false
      const pending = gate.runOperation({ op: 'resume', sessionId: 's-1', force: true, authorization: { token: lease.token, epoch: lease.epoch } }, async (ticket) => {
        const delegate = ticket.delegateSharedSpawn('s-1')
        await gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate }, async () => { helperConsumed = true })
        readinessEntered = true
        await ready
        return { ok: true }
      })
      while (!readinessEntered) await new Promise((resolve) => setTimeout(resolve, 1))
      const during = gate.readState()
      assert.equal(helperConsumed, true)
      assert.equal(during.tickets.some((ticket) => ticket.operation === 'resume' && ticket.sessionId === 's-1'), true)
      assert.equal(during.capabilities[0]?.state, 'inflight')
      releaseReady()
      assert.deepEqual(await pending, { ok: true })
      assert.equal(gate.readState().tickets.length, 0)
      assert.equal(gate.readState().capabilities[0]?.state, 'committed')
    } finally { f.cleanup() }
  })

  await t.test('shared spawn rechecks the live resume owner before mutating delegated authority', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'resume', sessionId: 's-1', force: true }], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      let callbacks = 0
      await gate.runOperation({ op: 'resume', sessionId: 's-1', force: true, authorization: { token: lease.token, epoch: lease.epoch } }, async (ticket) => {
        const delegate = ticket.delegateSharedSpawn('s-1')
        const statePath = join(f.root, 'session-maintenance.json')
        const beforeState = readFileSync(statePath, 'utf8')
        const beforeEvents = JSON.stringify(f.events)
        f.readings.set(8001, 'ambiguous')
        await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate }, async () => { callbacks++ }), 'maintenance_delegate_invalid')
        assert.equal(callbacks, 0)
        assert.equal(readFileSync(statePath, 'utf8'), beforeState)
        assert.equal(JSON.stringify(f.events), beforeEvents)
        f.readings.set(8001, { pid: 8001, startToken: 'ticket-owner-a' })
      })
    } finally { f.cleanup() }
  })

  await t.test('shared spawn is ordinary only when open without maintenance authority', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const callbacks: string[] = []
      await gate.runOperation({ op: 'shared-spawn', sessionId: 's-1' }, async () => {
        callbacks.push('open-empty')
        assert.deepEqual(gate.readState().tickets.map((ticket) => ({ operation: ticket.operation, sessionId: ticket.sessionId })), [
          { operation: 'shared-spawn', sessionId: 's-1' },
        ])
      })
      assert.deepEqual(callbacks, ['open-empty'])
      assert.equal(gate.readState().tickets.length, 0)

      const before = JSON.stringify({ state: gate.readState(), events: f.events })
      await expectCode(gate.runOperation({ op: 'shared-spawn', sessionId: 's-1', delegate: '' }, async () => {
        callbacks.push('open-explicit')
      }), 'maintenance_delegate_invalid')
      assert.deepEqual(callbacks, ['open-empty'])
      assert.equal(JSON.stringify({ state: gate.readState(), events: f.events }), before)
    } finally { f.cleanup() }
  })

  await t.test('explicit maintenance authority never degrades to ordinary admission', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const callbacks: string[] = []
      await expectCode(gate.runOperation({
        op: 'stop', sessionId: 's-1', authorization: { token: '00'.repeat(32), epoch: 0 },
      }, async () => { callbacks.push('stale-open-stop') }), 'maintenance_conflict')
      assert.deepEqual(callbacks, [])
      assert.equal(gate.readState().tickets.length, 0)
    } finally { f.cleanup() }
  })

  await t.test('ordinary parent admission cannot bypass privileged operations', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const entered = deferred(); const inspect = deferred()
      const callbacks: string[] = []
      const parent = gate.runOperation({ op: 'send', sessionId: 's-parent' }, async () => {
        entered.resolve(); await inspect.promise
        for (const operation of [
          { op: 'stop', sessionId: 's-1' },
          { op: 'resume', sessionId: 's-1', force: false },
          { op: 'shared-spawn', sessionId: 's-1', delegate: 'ff'.repeat(32) },
        ] as Operation[]) {
          await expectCode(gate.runOperation(operation, async () => { callbacks.push(operation.op) }), 'maintenance_active')
        }
      })
      await entered.promise
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }, { op: 'resume', sessionId: 's-1', force: false }],
        owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      assert.equal(lease.state, 'draining')
      inspect.resolve(); await parent
      assert.deepEqual(callbacks, [])
    } finally { f.cleanup() }
  })

  await t.test('active durable row never lets an inherited ordinary parent bypass exact authority', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-parent-active-a-'))
    const result = join(root, 'result.json')
    const runner = join(root, 'runner.mts')
    const parentStart = processStartToken(process.pid); assert.ok(parentStart)
    const token = '8a'.repeat(32)
    const durable = {
      version: 1,
      state: 'active',
      epoch: 12,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      owner: { instanceId: 'active-parent-generation', pid: process.pid, startToken: parentStart },
      heartbeatDeadline: Date.now() + 60_000,
      capabilities: [
        { capability: { op: 'stop', sessionId: 's-1' }, state: 'unused' },
        { capability: { op: 'resume', sessionId: 's-1', force: false }, state: 'unused' },
      ],
      tickets: [{
        id: 'ordinary-parent-ticket', epoch: 11, operation: 'send', sessionId: 's-parent',
        owner: { pid: process.pid, startToken: parentStart }, deadline: Date.now() + 60_000, mode: 'ordinary',
      }],
      delegates: [],
    }
    writeFileSync(join(root, 'session-maintenance.json'), JSON.stringify(durable, null, 2))
    writeFileSync(runner, `
import { writeFileSync } from 'node:fs'
import { processStartToken } from ${JSON.stringify(new URL('./process-identity.js', import.meta.url).href)}
import { createSessionMaintenance } from ${JSON.stringify(new URL('./session-maintenance.js', import.meta.url).href)}
const [root, result] = process.argv.slice(2)
const startToken = processStartToken(process.pid)
const gate = createSessionMaintenance({ runtimeRoot: root, now: () => Date.now(), randomBytes: (size) => Buffer.alloc(size, 0x8b),
  processIdentity: (pid) => { const token = processStartToken(pid); return token ? { pid, startToken: token } : null },
  selfIdentity: () => ({ pid: process.pid, startToken }), ticketReportMs: 1000 })
const callbacks = []
const codes = []
for (const operation of [
  { op: 'stop', sessionId: 's-1' },
  { op: 'resume', sessionId: 's-1', force: false },
  { op: 'shared-spawn', sessionId: 's-1', delegate: 'ff'.repeat(32) },
]) {
  try { await gate.runOperation(operation, async () => callbacks.push(operation.op)); codes.push(null) }
  catch (error) { codes.push(error?.code ?? 'unknown') }
}
writeFileSync(result, JSON.stringify({ callbacks, codes }))
`)
    try {
      const child = spawn(tsx, [runner, root, result], {
        env: { ...process.env, SPEXCODE_MAINTENANCE_PARENT_TICKET: 'ordinary-parent-ticket' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''; child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
      const [code] = await bounded(once(child, 'close') as Promise<[number | null]>, 'active parent fixture exit')
      assert.equal(code, 0, stderr)
      assert.deepEqual(JSON.parse(readFileSync(result, 'utf8')), {
        callbacks: [], codes: ['maintenance_token_invalid', 'maintenance_token_invalid', 'maintenance_delegate_invalid'],
      })
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  await t.test('refused maintenance result leaves exact capability retryable', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const lease = await gate.acquireLease({
        capabilities: [{ op: 'stop', sessionId: 's-1' }],
        owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      const authorization = { token: lease.token, epoch: lease.epoch }
      const refused = await gate.runOperation({ op: 'stop', sessionId: 's-1', authorization }, async () => ({ ok: false, refused: true }))
      assert.deepEqual(refused, { ok: false, refused: true })
      assert.equal(gate.readState().capabilities[0]?.state, 'unused')
      let retries = 0
      await gate.runOperation({ op: 'stop', sessionId: 's-1', authorization }, async () => { retries++ })
      assert.equal(retries, 1)
    } finally { f.cleanup() }
  })

  await t.test('release authenticates before disclosing live ticket state', async () => {
    const f = makeFixture()
    try {
      const gate = f.create()
      const entered = deferred(); const finish = deferred()
      const live = gate.runOperation({ op: 'send', sessionId: 's-live' }, async () => {
        entered.resolve(); await finish.promise
      })
      await entered.promise
      const lease = await gate.acquireLease({
        capabilities: [], owner: { instanceId: 'lease-generation-a', pid: 7001, startToken: 'lease-owner-a' }, ttlMs: 30_000, waitMs: 0,
      })
      assert.equal(lease.state, 'draining')
      await expectCode(gate.releaseLease({ token: '00'.repeat(32), epoch: lease.epoch }), 'maintenance_token_invalid')
      finish.resolve(); await live
      await gate.releaseLease({ token: lease.token, epoch: lease.epoch })
    } finally { f.cleanup() }
  })

  await t.test('lock publication cannot wedge when a creator crashes before publishing an owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-lock-a-'))
    const lock = join(root, '.session-maintenance.lock')
    try {
      mkdirSync(lock)
      const start = Date.now()
      await assert.doesNotReject(async () => {
        const gate = (await import('./session-maintenance.js') as MaintenanceModule).createSessionMaintenance({
          runtimeRoot: root, now: () => Date.now(), randomBytes: (size) => Buffer.alloc(size, 0x6b),
          processIdentity: () => null, selfIdentity: () => ({ pid: process.pid, startToken: 'self' }), ticketReportMs: 1_000,
        })
        assert.equal(gate.readState().state, 'open')
      })
      assert.ok(Date.now() - start < 500, 'a crash before owner publication cannot wedge the coordinator lock')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  await t.test('a stale reaper cannot remove a replacement lock owner after its proof', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-lock-aba-a-'))
    const lock = join(root, '.session-maintenance.lock')
    const barrier = join(root, 'start')
    const results = [join(root, 'result-a.json'), join(root, 'result-b.json')]
    const runner = join(root, 'runner.mts')
    try {
      writeFileSync(lock, JSON.stringify({ version: 1, nonce: 'stale-lock-generation', owner: { pid: 999_999_991, startToken: 'dead-owner' } }))
      writeFileSync(runner, `
import { existsSync, writeFileSync } from 'node:fs'
import { processStartToken } from ${JSON.stringify(new URL('./process-identity.js', import.meta.url).href)}
import { createSessionMaintenance } from ${JSON.stringify(new URL('./session-maintenance.js', import.meta.url).href)}
const [runtimeRoot, resultPath, barrier] = process.argv.slice(2)
const startToken = processStartToken(process.pid)
writeFileSync(resultPath + '.ready', '')
while (!existsSync(barrier)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
try {
  createSessionMaintenance({ runtimeRoot, now: () => Date.now(), randomBytes: (size) => Buffer.alloc(size, 0x6c),
    processIdentity: (pid) => { const token = processStartToken(pid); return token ? { pid, startToken: token } : null },
    selfIdentity: () => ({ pid: process.pid, startToken }), ticketReportMs: 1000 })
  writeFileSync(resultPath, JSON.stringify({ ok: true }))
} catch (error) { writeFileSync(resultPath, JSON.stringify({ ok: false, code: error?.code ?? 'unknown' })) }
`)
      const children = results.map((resultPath) => {
        const child = spawn(tsx, [runner, root, resultPath, barrier], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stderr = ''; child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
        return { child, stderr: () => stderr, closed: once(child, 'close') as Promise<[number | null]> }
      })
      await waitUntil(() => results.every((path) => existsSync(`${path}.ready`)), 'both stale reapers ready')
      writeFileSync(barrier, '')
      const exits = await Promise.all(children.map(({ closed }, index) => bounded(closed, `stale reaper ${index} exit`, 10_000)))
      exits.forEach(([code], index) => assert.equal(code, 0, children[index].stderr()))
      assert.deepEqual(results.map((path) => JSON.parse(readFileSync(path, 'utf8'))), [{ ok: true }, { ok: true }])
      assert.equal(existsSync(lock), false)
      assert.equal(JSON.parse(readFileSync(join(root, 'session-maintenance.json'), 'utf8')).state, 'open')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  await t.test('a dead reaper marker owner is reclaimed before the next exact contender acquires', async (t) => {
    for (const crashPoint of ['before-canonical-unlink', 'after-canonical-unlink'] as const) await t.test(crashPoint, async () => {
    const root = mkdtempSync(join(tmpdir(), 'spex-maintenance-reaper-crash-a-'))
    const lock = join(root, '.session-maintenance.lock')
    const observed = join(root, 'marker-published')
    const preload = join(root, 'preload.cjs')
    const runner = join(root, 'runner.mts')
    const firstResult = join(root, 'first.json')
    const nextResult = join(root, 'next.json')
    try {
      writeFileSync(lock, JSON.stringify({ version: 1, nonce: 'crashed-reaper-target', owner: { pid: 999_999_991, startToken: 'dead-owner' } }))
      writeFileSync(preload, `
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const original = fs.unlinkSync
fs.unlinkSync = function(path) {
  if (path === process.env.SPEX_LOCK_RACE_PATH) {
    if (process.env.SPEX_LOCK_CRASH_POINT === 'after-canonical-unlink') original.call(this, path)
    fs.writeFileSync(process.env.SPEX_LOCK_OBSERVED, '')
    while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
  }
  return original.call(this, path)
}
syncBuiltinESMExports()
`)
      writeFileSync(runner, `
import { writeFileSync } from 'node:fs'
import { processStartToken } from ${JSON.stringify(new URL('./process-identity.js', import.meta.url).href)}
import { createSessionMaintenance } from ${JSON.stringify(new URL('./session-maintenance.js', import.meta.url).href)}
const [root, result] = process.argv.slice(2)
const startToken = processStartToken(process.pid)
try {
  createSessionMaintenance({ runtimeRoot: root, now: () => Date.now(), randomBytes: (size) => Buffer.alloc(size, 0x9c),
    processIdentity: (pid) => { const token = processStartToken(pid); return token ? { pid, startToken: token } : null },
    selfIdentity: () => ({ pid: process.pid, startToken }), ticketReportMs: 1000 })
  writeFileSync(result, JSON.stringify({ ok: true }))
} catch (error) { writeFileSync(result, JSON.stringify({ ok: false, code: error?.code ?? 'unknown' })) }
`)
      const reaper = spawn(tsx, [runner, root, firstResult], {
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require=${preload}`,
          SPEX_LOCK_RACE_PATH: lock,
          SPEX_LOCK_OBSERVED: observed,
          SPEX_LOCK_CRASH_POINT: crashPoint,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      await waitUntil(() => existsSync(observed), 'reaper marker publication')
      const marker = join(root, '.session-maintenance.lock.reap-crashed-reaper-target')
      const markerRow = JSON.parse(readFileSync(marker, 'utf8'))
      assert.deepEqual(processStartToken(markerRow.owner.pid), markerRow.owner.startToken)
      process.kill(markerRow.owner.pid, 'SIGKILL')
      await bounded(once(reaper, 'close') as Promise<[number | null]>, 'crashed reaper exit')
      assert.notEqual(processStartToken(markerRow.owner.pid), markerRow.owner.startToken)

      const next = spawn(tsx, [runner, root, nextResult], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''; next.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
      const [code] = await bounded(once(next, 'close') as Promise<[number | null]>, 'next contender exit', 10_000)
      assert.equal(code, 0, stderr)
      assert.deepEqual(JSON.parse(readFileSync(nextResult, 'utf8')), { ok: true })
      assert.equal(existsSync(marker), false)
      assert.equal(existsSync(lock), false)
    } finally { rmSync(root, { recursive: true, force: true }) }
    })
  })
})
