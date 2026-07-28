import { AsyncLocalStorage } from 'node:async_hooks'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes as cryptoRandomBytes, timingSafeEqual } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import { runtimeRoot as projectRuntimeRoot } from './layout.js'
import { parseProcStat, processStartToken } from './process-identity.js'

export type ProcessIdentity = { pid: number; startToken: string }
export type LeaseOwner = ProcessIdentity & { instanceId: string }
export type ProcessReading = ProcessIdentity | null | 'ambiguous'
export type Capability =
  | { op: 'stop'; sessionId: string }
  | { op: 'resume'; sessionId: string; force: boolean }
export type Authorization = { token: string; epoch: number }
export type Operation =
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

type CapabilityState = 'unused' | 'inflight' | 'committed' | 'indeterminate'
type CapabilityEntry = { capability: Capability; state: CapabilityState; requestId?: string }
type Ticket = {
  id: string
  epoch: number
  operation: Operation['op']
  sessionId?: string
  force?: boolean
  owner: ProcessIdentity
  deadline: number
  mode?: 'ordinary' | 'maintenance'
  parentTicketId?: string
}
type Delegate = {
  tokenHash: string
  parentTicketId: string
  epoch: number
  operation: 'shared-spawn'
  sessionId: string
  state: 'unused' | 'running' | 'completed'
}
type DurableState = {
  version: 1
  state: 'open' | 'draining' | 'active'
  epoch: number
  tokenHash: string | null
  owner: LeaseOwner | null
  heartbeatDeadline: number | null
  capabilities: CapabilityEntry[]
  tickets: Ticket[]
  delegates: Delegate[]
}
export type MaintenanceTicket = {
  id: string
  epoch: number
  delegateSharedSpawn(sessionId: string): string
}
export type MaintenanceLease = {
  token: string
  epoch: number
  state: 'draining' | 'active'
  owner: LeaseOwner
  capabilities: readonly Capability[]
}
export type MaintenanceState = {
  state: DurableState['state']
  epoch: number
  owner: LeaseOwner | null
  heartbeatDeadline: number | null
  tickets: readonly {
    operation: Operation['op']
    sessionId?: string
    force?: boolean
    owner: ProcessIdentity
    deadline: number
  }[]
  capabilities: readonly CapabilityEntry[]
}

type CoordinatorInput = {
  runtimeRoot: string
  now: () => number
  randomBytes: (size: number) => Buffer
  processIdentity: (pid: number) => ProcessReading
  selfIdentity: () => ProcessIdentity
  ticketReportMs: number
  onEvent?: (event: Record<string, unknown>) => void
}

const OPERATIONS = new Set<Operation['op']>([
  'create', 'fallback-create', 'lifecycle-transition', 'hook-state', 'send', 'raw-key-input',
  'terminal-input', 'interrupt', 'rename', 'sort', 'stop', 'resume', 'archive', 'close',
  'merge-dispatch', 'queue-drain', 'attach', 'shared-spawn',
])
const MIN_TTL_MS = 5_000
const MAX_TTL_MS = 300_000
const MAX_WAIT_MS = 120_000
const LOCK_WAIT_MS = 5_000
const syncPause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const context = new AsyncLocalStorage<{ ticketId: string }>()

export class SessionMaintenanceError extends Error {
  readonly code: string
  readonly state?: DurableState['state']
  readonly epoch?: number
  readonly operation?: Operation['op']
  readonly sessionId?: string

  constructor(code: string, message: string, details: Partial<Pick<SessionMaintenanceError, 'state' | 'epoch' | 'operation' | 'sessionId'>> = {}) {
    super(message)
    this.name = 'SessionMaintenanceError'
    this.code = code
    Object.assign(this, details)
  }
}

const fail = (code: string, message: string, details?: Partial<Pick<SessionMaintenanceError, 'state' | 'epoch' | 'operation' | 'sessionId'>>): never => {
  throw new SessionMaintenanceError(code, message, details)
}
const emptyState = (): DurableState => ({
  version: 1, state: 'open', epoch: 0, tokenHash: null, owner: null, heartbeatDeadline: null,
  capabilities: [], tickets: [], delegates: [],
})
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
const sameIdentity = (a: ProcessIdentity | null | undefined, b: ProcessIdentity | null | undefined): boolean =>
  !!a && !!b && a.pid === b.pid && a.startToken === b.startToken
const operationSession = (operation: Operation): string | undefined => 'sessionId' in operation ? operation.sessionId : undefined
const operationForce = (operation: Operation): boolean | undefined => operation.op === 'resume' ? operation.force : undefined

function canonicalCapabilities(input: readonly Capability[]): Capability[] {
  if (!Array.isArray(input)) fail('maintenance_invalid', 'maintenance capabilities must be an array')
  const seen = new Set<string>()
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || typeof raw.sessionId !== 'string' || !raw.sessionId.trim())
      fail('maintenance_invalid', 'maintenance capability needs an exact session id')
    const capability: Capability = raw.op === 'stop' && Object.keys(raw).every((key) => key === 'op' || key === 'sessionId')
      ? { op: 'stop', sessionId: raw.sessionId }
      : raw.op === 'resume' && typeof raw.force === 'boolean'
        && Object.keys(raw).every((key) => key === 'op' || key === 'sessionId' || key === 'force')
        ? { op: 'resume', sessionId: raw.sessionId, force: raw.force }
        : fail('maintenance_invalid', 'maintenance capability must be exact stop or resume authority')
    const key = `${capability.op}\0${capability.sessionId}`
    if (seen.has(key)) fail('maintenance_invalid', `duplicate maintenance capability for ${capability.op} ${capability.sessionId}`)
    seen.add(key)
    return capability
  })
}

function normalizeState(raw: unknown): DurableState {
  if (!raw || typeof raw !== 'object') fail('maintenance_state_invalid', 'session maintenance state is unreadable')
  const value = raw as Partial<DurableState>
  if (value.version !== 1 || !['open', 'draining', 'active'].includes(String(value.state)) || !Number.isSafeInteger(value.epoch) || Number(value.epoch) < 0)
    fail('maintenance_state_invalid', 'session maintenance state has an invalid version, state, or epoch')
  return {
    version: 1,
    state: value.state as DurableState['state'],
    epoch: Number(value.epoch),
    tokenHash: typeof value.tokenHash === 'string' ? value.tokenHash : null,
    owner: value.owner && typeof value.owner.instanceId === 'string' && value.owner.instanceId
      && Number.isInteger(value.owner.pid) && typeof value.owner.startToken === 'string'
      ? copy(value.owner as LeaseOwner)
      : null,
    heartbeatDeadline: typeof value.heartbeatDeadline === 'number' ? value.heartbeatDeadline : null,
    capabilities: Array.isArray(value.capabilities) ? copy(value.capabilities) : [],
    tickets: Array.isArray(value.tickets) ? copy(value.tickets) : [],
    delegates: Array.isArray(value.delegates) ? copy(value.delegates) : [],
  }
}

function presentedTokenMatches(token: string, expectedHash: string | null): boolean {
  const actual = createHash('sha256').update(token).digest()
  const valid = typeof expectedHash === 'string' && /^[0-9a-f]{64}$/i.test(expectedHash)
  const expected = valid ? Buffer.from(expectedHash!, 'hex') : Buffer.alloc(actual.length)
  return timingSafeEqual(actual, expected) && valid
}

function parentPid(pid: number): number | null {
  if (platform() === 'linux') {
    try { return parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8')).ppid } catch { return null }
  }
  try {
    const value = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim())
    return Number.isInteger(value) && value > 0 ? value : null
  } catch { return null }
}

function isDescendantOf(pid: number, owner: ProcessIdentity, readIdentity: (pid: number) => ProcessReading): boolean {
  const ownerReading = readIdentity(owner.pid)
  if (ownerReading === 'ambiguous' || !sameIdentity(ownerReading, owner)) return false
  let current = pid
  for (let depth = 0; depth < 64 && current > 1; depth++) {
    if (current === owner.pid) return true
    const parent = parentPid(current)
    if (!parent || parent === current) return false
    current = parent
  }
  return false
}

export function createSessionMaintenance(input: CoordinatorInput) {
  const statePath = join(input.runtimeRoot, 'session-maintenance.json')
  const lockPath = join(input.runtimeRoot, '.session-maintenance.lock')
  const lockPrefix = '.session-maintenance.lock.reap-'
  mkdirSync(input.runtimeRoot, { recursive: true })

  const identityState = (owner: ProcessIdentity): 'live' | 'dead' | 'reused' | 'ambiguous' => {
    const reading = input.processIdentity(owner.pid)
    if (reading === 'ambiguous') return 'ambiguous'
    if (reading === null) return 'dead'
    return sameIdentity(reading, owner) ? 'live' : 'reused'
  }

  type LockRecord = { version: 1; nonce: string; owner: ProcessIdentity }
  const readLock = (path = lockPath): LockRecord | null => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
      return raw.version === 1 && typeof raw.nonce === 'string' && raw.nonce
        && raw.owner && Number.isInteger(raw.owner.pid) && typeof raw.owner.startToken === 'string'
        ? raw as LockRecord
        : null
    } catch { return null }
  }
  const writeLinkedRecord = (path: string, record: LockRecord): boolean => {
    const temp = join(input.runtimeRoot, `.session-maintenance.owner-${process.pid}-${record.nonce}.tmp`)
    let fd: number | null = null
    try {
      fd = openSync(temp, 'wx', 0o600)
      writeFileSync(fd, JSON.stringify(record))
      fsyncSync(fd)
      closeSync(fd); fd = null
      linkSync(temp, path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return false
    } finally {
      if (fd !== null) closeSync(fd)
      try { unlinkSync(temp) } catch { /* linked or already absent */ }
    }
  }
  const reapMarkers = (): string[] => {
    try { return readdirSync(input.runtimeRoot).filter((name) => name.startsWith(lockPrefix)) }
    catch { return [] }
  }
  const sameLockRecord = (left: LockRecord | null, right: LockRecord): boolean =>
    !!left && left.nonce === right.nonce && sameIdentity(left.owner, right.owner)
  const reclaimDeadRecord = (path: string, expected: LockRecord, depth = 0): boolean => {
    if (depth >= 64) fail('maintenance_conflict', 'session maintenance lock claim depth exceeded')
    if (!sameLockRecord(readLock(path), expected) || !['dead', 'reused'].includes(identityState(expected.owner))) return false
    const claimPath = `${path}.claim`
    const self = input.selfIdentity()
    const claim: LockRecord = { version: 1, nonce: input.randomBytes(16).toString('hex'), owner: self }
    if (!writeLinkedRecord(claimPath, claim)) {
      const existing = readLock(claimPath)
      if (!existing || !['dead', 'reused'].includes(identityState(existing.owner))) return false
      if (!reclaimDeadRecord(claimPath, existing, depth + 1)) return false
      return reclaimDeadRecord(path, expected, depth + 1)
    }
    try {
      const confirmed = readLock(path)
      if (!sameLockRecord(confirmed, expected) || !['dead', 'reused'].includes(identityState(expected.owner))) return false
      unlinkSync(path)
      return true
    } finally {
      if (sameLockRecord(readLock(claimPath), claim)) unlinkSync(claimPath)
    }
  }
  const clearDeadMarkers = (): boolean => {
    for (const name of reapMarkers()) {
      const path = join(input.runtimeRoot, name)
      const marker = readLock(path)
      if (marker && ['dead', 'reused'].includes(identityState(marker.owner))) reclaimDeadRecord(path, marker)
    }
    return reapMarkers().length === 0
  }

  const acquireLock = (): (() => void) => {
    const deadline = Date.now() + LOCK_WAIT_MS
    const self = input.selfIdentity()
    const nonce = input.randomBytes(16).toString('hex')
    const own: LockRecord = { version: 1, nonce, owner: self }
    for (;;) {
      if (clearDeadMarkers() && writeLinkedRecord(lockPath, own)) {
        return () => {
          const current = readLock()
          if (!current || current.nonce !== nonce || !sameIdentity(current.owner, self))
            fail('maintenance_conflict', 'session maintenance lock ownership changed before release')
          unlinkSync(lockPath)
        }
      }

      const current = readLock()
      if (!current) {
        // Legacy mkdir-before-owner residue is the old crash window this protocol removes. It has no
        // complete identity that can authorize a state mutation, so remove only an empty directory.
        try { if (readdirSync(lockPath).length === 0) rmSync(lockPath, { recursive: true }) } catch { /* file or live legacy owner */ }
      } else if (['dead', 'reused'].includes(identityState(current.owner))) {
        const markerPath = join(input.runtimeRoot, `${lockPrefix}${current.nonce}`)
        const marker: LockRecord = { version: 1, nonce: input.randomBytes(16).toString('hex'), owner: self }
        if (writeLinkedRecord(markerPath, marker)) {
          try {
            const confirmed = readLock()
            if (confirmed?.nonce === current.nonce && sameIdentity(confirmed.owner, current.owner)
              && ['dead', 'reused'].includes(identityState(confirmed.owner))) unlinkSync(lockPath)
          } finally {
            const claim = readLock(markerPath)
            if (claim?.nonce === marker.nonce && sameIdentity(claim.owner, self)) unlinkSync(markerPath)
          }
          continue
        }
      }
      if (Date.now() >= deadline) fail('maintenance_conflict', 'session maintenance state lock is held by a live or ambiguous owner')
      syncPause(5)
    }
  }

  const load = (): { state: DurableState; exists: boolean } => {
    if (!existsSync(statePath)) return { state: emptyState(), exists: false }
    try { return { state: normalizeState(JSON.parse(readFileSync(statePath, 'utf8'))), exists: true } }
    catch (error) {
      if (error instanceof SessionMaintenanceError) throw error
      return fail('maintenance_state_invalid', `session maintenance state is unreadable: ${(error as Error).message}`)
    }
  }
  const persist = (state: DurableState): void => {
    const temp = `${statePath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, statePath)
  }

  const recover = (state: DurableState, protectedTicketId?: string): boolean => {
    let dirty = false
    const retained: Ticket[] = []
    for (const ticket of state.tickets) {
      const ownerState = ticket.id === protectedTicketId ? 'live' : identityState(ticket.owner)
      if (ownerState === 'live' || ownerState === 'ambiguous') {
        retained.push(ticket)
        continue
      }
      dirty = true
      if (ticket.mode === 'maintenance') {
        const entry = state.capabilities.find(({ capability }) => capability.op === ticket.operation
          && capability.sessionId === ticket.sessionId
          && (capability.op !== 'resume' || capability.force === ticket.force))
        if (entry?.state === 'inflight' && entry.requestId === ticket.id) {
          entry.state = 'indeterminate'
          delete entry.requestId
        }
      }
      for (const delegate of state.delegates) if (delegate.parentTicketId === ticket.id && delegate.state !== 'completed') delegate.state = 'completed'
    }
    if (retained.length !== state.tickets.length) state.tickets = retained

    if (state.state !== 'open' && state.tokenHash && state.owner) {
      const ownerState = identityState(state.owner)
      if (ownerState === 'dead' || ownerState === 'reused' || input.now() > (state.heartbeatDeadline ?? -Infinity)) {
        state.state = 'draining'
        state.tokenHash = null
        state.owner = null
        state.heartbeatDeadline = null
        for (const entry of state.capabilities) if (entry.state === 'inflight') {
          entry.state = 'indeterminate'
          delete entry.requestId
        }
        dirty = true
      }
    }
    if (state.state === 'draining' && state.tickets.length === 0) {
      if (state.tokenHash && state.owner && input.now() <= (state.heartbeatDeadline ?? -Infinity)) state.state = 'active'
      else {
        state.state = 'open'
        state.tokenHash = null
        state.owner = null
        state.heartbeatDeadline = null
        state.capabilities = []
        state.delegates = []
      }
      dirty = true
    }
    return dirty
  }

  const locked = <T>(body: (state: DurableState, dirty: () => void) => T, beforeRecover?: (state: DurableState) => string | undefined): T => {
    const release = acquireLock()
    try {
      const loaded = load()
      let changed = !loaded.exists
      const protectedTicketId = beforeRecover?.(loaded.state)
      if (recover(loaded.state, protectedTicketId)) changed = true
      const value = body(loaded.state, () => { changed = true })
      if (changed) persist(loaded.state)
      return value
    } finally { release() }
  }

  locked((_state, dirty) => { if (!existsSync(statePath)) dirty() })

  const verifyLease = (state: DurableState, authorization: Authorization): void => {
    if (state.state !== 'active' || authorization.epoch !== state.epoch)
      fail('maintenance_conflict', 'maintenance lease epoch is not active', { state: state.state, epoch: state.epoch })
    if (!presentedTokenMatches(authorization.token, state.tokenHash))
      fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch })
  }
  const capabilityFor = (state: DurableState, operation: Operation) => state.capabilities.find(({ capability }) =>
    capability.op === operation.op && capability.sessionId === operationSession(operation)
    && (capability.op !== 'resume' || capability.force === operationForce(operation)))

  const inheritedOrdinaryParent = (state: DurableState): Ticket | null => {
    const local = context.getStore()?.ticketId
    const inherited = process.env.SPEXCODE_MAINTENANCE_PARENT_TICKET?.trim()
    const id = local || inherited
    if (!id) return null
    const ticket = state.tickets.find((candidate) => candidate.id === id && candidate.mode !== 'maintenance')
    if (!ticket) return null
    if (local) return ticket
    return isDescendantOf(process.pid, ticket.owner, input.processIdentity) ? ticket : null
  }

  const sharedSpawnAuthority = (state: DurableState, operation: Extract<Operation, { op: 'shared-spawn' }>): { delegate: Delegate; parentTicket: Ticket } => {
    const raw = 'delegate' in operation ? operation.delegate : undefined
    const delegate = typeof raw === 'string' ? state.delegates.find((candidate) => candidate.epoch === state.epoch
      && candidate.operation === 'shared-spawn' && candidate.sessionId === operation.sessionId
      && presentedTokenMatches(raw, candidate.tokenHash)) : undefined
    const parentTicket = delegate && state.tickets.find((candidate) => candidate.id === delegate.parentTicketId
      && candidate.epoch === state.epoch && candidate.operation === 'resume'
      && candidate.sessionId === operation.sessionId && candidate.mode === 'maintenance')
    if (!delegate || delegate.state !== 'unused' || !parentTicket || identityState(parentTicket.owner) !== 'live')
      return fail('maintenance_delegate_invalid', 'shared-runtime delegate is forged, stale, completed, mismatched, replayed, or detached from its live resume owner', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
    return { delegate, parentTicket }
  }

  const beginTicket = (state: DurableState, operation: Operation, owner: ProcessIdentity, markDirty: () => void): Ticket => {
    if (!OPERATIONS.has(operation.op)) fail('maintenance_invalid', `unknown maintenance operation ${(operation as { op?: string }).op ?? ''}`)
    const parent = inheritedOrdinaryParent(state)
    const ticketId = input.randomBytes(16).toString('hex')
    let mode: Ticket['mode'] = 'ordinary'
    let parentTicketId: string | undefined

    if (operation.op === 'shared-spawn') {
      if (state.state === 'open') {
        if ('delegate' in operation) fail('maintenance_delegate_invalid', 'shared-runtime delegate channel is not valid outside active maintenance', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
      } else if (state.state !== 'active') {
        fail('maintenance_active', `session maintenance is ${state.state}; shared-spawn was not admitted`, { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
      } else {
        const { delegate, parentTicket } = sharedSpawnAuthority(state, operation)
        delegate.state = 'running'
        mode = 'maintenance'
        parentTicketId = parentTicket.id
      }
    } else if ((operation.op === 'stop' || operation.op === 'resume') && operation.authorization) {
      verifyLease(state, operation.authorization)
      const entry = capabilityFor(state, operation)
      if (!entry) return fail('maintenance_capability_missing', 'operation is not in the exact maintenance capability plan', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
      if (entry.state !== 'unused') fail('maintenance_capability_used', 'maintenance capability is already inflight, committed, or indeterminate', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
      entry.state = 'inflight'
      entry.requestId = ticketId
      mode = 'maintenance'
    } else if (state.state !== 'open' && (operation.op === 'stop' || operation.op === 'resume')) {
      if (state.state === 'active')
        return fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
      fail('maintenance_active', `session maintenance is ${state.state}; ${operation.op} was not admitted`, { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operation.sessionId })
    } else if (state.state === 'active' && 'authorization' in operation && operation.authorization) {
      verifyLease(state, operation.authorization)
      fail('maintenance_capability_missing', 'operation is not in the exact maintenance capability plan', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
    } else if (state.state !== 'open' && parent) parentTicketId = parent.id
    else if (state.state !== 'open') {
      if ('delegate' in operation) fail('maintenance_delegate_invalid', 'shared-runtime delegate is not valid for this operation', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
      fail('maintenance_active', `session maintenance is ${state.state}; ${operation.op} was not admitted`, { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
    }

    const ticket: Ticket = {
      id: ticketId, epoch: state.epoch, operation: operation.op,
      ...(operationSession(operation) ? { sessionId: operationSession(operation) } : {}),
      ...(operationForce(operation) !== undefined ? { force: operationForce(operation) } : {}),
      owner, deadline: input.now() + input.ticketReportMs, mode,
      ...(parentTicketId ? { parentTicketId } : {}),
    }
    state.tickets.push(ticket)
    markDirty()
    return ticket
  }

  const beginOperationTicket = (operation: Operation, owner: ProcessIdentity): Ticket => locked(
    (state, dirty) => beginTicket(state, operation, owner, dirty),
    (state) => {
      if (operation.op !== 'shared-spawn' || state.state !== 'active') return undefined
      // Protect the proven-live parent from recovery, then re-read it in beginTicket before delegate mutation.
      return sharedSpawnAuthority(state, operation).parentTicket.id
    },
  )

  const finishTicket = (ticketId: string, outcome: 'committed' | 'retryable' | 'indeterminate'): void => locked((state, dirty) => {
    const index = state.tickets.findIndex((ticket) => ticket.id === ticketId)
    if (index < 0) return
    const [ticket] = state.tickets.splice(index, 1)
    if (ticket.mode === 'maintenance' && (ticket.operation === 'stop' || ticket.operation === 'resume')) {
      const entry = state.capabilities.find(({ capability }) => capability.op === ticket.operation
        && capability.sessionId === ticket.sessionId && (capability.op !== 'resume' || capability.force === ticket.force))
      if (entry?.state === 'inflight' && entry.requestId === ticket.id) {
        entry.state = outcome === 'retryable' ? 'unused' : outcome
        delete entry.requestId
      }
    }
    if (ticket.operation === 'shared-spawn' && ticket.parentTicketId) {
      const delegate = state.delegates.find((candidate) => candidate.parentTicketId === ticket.parentTicketId
        && candidate.sessionId === ticket.sessionId && candidate.state === 'running')
      if (delegate) delegate.state = 'completed'
    }
    dirty()
  })

  const delegateForTicket = (ticketId: string, sessionId: string): string => locked((state, dirty) => {
    const ticket = state.tickets.find((candidate) => candidate.id === ticketId && candidate.operation === 'resume'
      && candidate.mode === 'maintenance' && candidate.sessionId === sessionId && candidate.epoch === state.epoch)
    if (!ticket || state.state !== 'active') return fail('maintenance_delegate_invalid', 'resume ticket is not live for this session')
    if (state.delegates.some((delegate) => delegate.parentTicketId === ticket.id))
      fail('maintenance_delegate_invalid', 'resume ticket already delegated its shared spawn')
    const token = input.randomBytes(32).toString('hex')
    state.delegates.push({ tokenHash: hashToken(token), parentTicketId: ticket.id, epoch: state.epoch, operation: 'shared-spawn', sessionId, state: 'unused' })
    dirty()
    return token
  })

  const readState = (): MaintenanceState => locked((state) => ({
    state: state.state,
    epoch: state.epoch,
    owner: copy(state.owner),
    heartbeatDeadline: state.heartbeatDeadline,
    tickets: copy(state.tickets.map((ticket) => ({
      operation: ticket.operation,
      ...(ticket.sessionId ? { sessionId: ticket.sessionId } : {}),
      ...(ticket.force !== undefined ? { force: ticket.force } : {}),
      owner: ticket.owner,
      deadline: ticket.deadline,
    }))),
    capabilities: copy(state.capabilities),
  }))

  const acquireLease = async ({ capabilities: rawCapabilities, owner, ttlMs, waitMs }: { capabilities: readonly Capability[]; owner: LeaseOwner; ttlMs: number; waitMs: number }): Promise<MaintenanceLease> => {
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS || !Number.isFinite(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS || waitMs > ttlMs)
      fail('maintenance_invalid', 'maintenance ttl/wait is outside the finite bounds')
    if (identityState(owner) !== 'live') fail('maintenance_invalid', 'maintenance lease owner identity is not exact and live')
    const capabilities = canonicalCapabilities(rawCapabilities)
    const token = input.randomBytes(32).toString('hex')
    const started = locked((state, dirty) => {
      if (state.state !== 'open') fail('maintenance_conflict', `session maintenance is already ${state.state}`, { state: state.state, epoch: state.epoch })
      state.state = 'draining'
      state.epoch += 1
      state.tokenHash = hashToken(token)
      state.owner = copy(owner)
      state.heartbeatDeadline = input.now() + ttlMs
      state.capabilities = capabilities.map((capability) => ({ capability, state: 'unused' }))
      state.delegates = []
      if (state.tickets.length === 0) state.state = 'active'
      dirty()
      return {
        token,
        epoch: state.epoch,
        state: state.state as MaintenanceLease['state'],
        owner: copy(owner),
        capabilities: copy(capabilities),
      }
    })
    input.onEvent?.({ type: 'maintenance-acquire', state: started.state, epoch: started.epoch })
    if (started.state === 'active' || waitMs === 0) return started
    const deadline = input.now() + waitMs
    for (;;) {
      const current = readState()
      if (current.epoch !== started.epoch || current.state === 'open') fail('maintenance_conflict', 'maintenance acquisition lost its epoch')
      if (current.state === 'active') return { ...started, state: 'active' }
      if (input.now() >= deadline) return started
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  const heartbeatLease = async ({ token, epoch, ttlMs }: { token: string; epoch: number; ttlMs: number }): Promise<void> => {
    if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) fail('maintenance_invalid', 'maintenance heartbeat ttl is outside the finite bounds')
    locked((state, dirty) => {
      if (state.epoch !== epoch || (state.state !== 'active' && state.state !== 'draining')) fail('maintenance_conflict', 'maintenance heartbeat names a stale epoch', { state: state.state, epoch: state.epoch })
      if (!presentedTokenMatches(token, state.tokenHash)) fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch })
      state.heartbeatDeadline = input.now() + ttlMs
      dirty()
    })
    input.onEvent?.({ type: 'maintenance-heartbeat', epoch })
  }

  const releaseLease = async ({ token, epoch }: { token: string; epoch: number }): Promise<void> => {
    locked((state, dirty) => {
      if (state.epoch !== epoch || state.state === 'open') fail('maintenance_conflict', 'maintenance release names a stale epoch', { state: state.state, epoch: state.epoch })
      if (!presentedTokenMatches(token, state.tokenHash)) fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch })
      if (state.tickets.length) fail('maintenance_tickets_live', 'maintenance cannot release while exact live or ambiguous tickets remain', { state: state.state, epoch: state.epoch })
      state.state = 'open'
      state.tokenHash = null
      state.owner = null
      state.heartbeatDeadline = null
      state.capabilities = []
      state.delegates = []
      dirty()
    })
    input.onEvent?.({ type: 'maintenance-release', epoch })
  }

  const runOperation = async <T>(operation: Operation, body: (ticket: MaintenanceTicket) => Promise<T> | T): Promise<T> => {
    const owner = input.selfIdentity()
    const ticket = beginOperationTicket(operation, owner)
    let outcome: 'committed' | 'retryable' | 'indeterminate' = 'indeterminate'
    try {
      const result = await context.run({ ticketId: ticket.id }, () => body({
        id: ticket.id,
        epoch: ticket.epoch,
        delegateSharedSpawn: (sessionId: string) => delegateForTicket(ticket.id, sessionId),
      }))
      outcome = (operation.op === 'stop' || operation.op === 'resume')
        && (result === false || (!!result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false))
        ? 'retryable'
        : 'committed'
      return result
    } finally {
      finishTicket(ticket.id, outcome)
    }
  }

  const runOperationSync = <T>(operation: Operation, body: (ticket: MaintenanceTicket) => T): T => {
    const owner = input.selfIdentity()
    const ticket = beginOperationTicket(operation, owner)
    let outcome: 'committed' | 'retryable' | 'indeterminate' = 'indeterminate'
    try {
      const result = context.run({ ticketId: ticket.id }, () => body({
        id: ticket.id,
        epoch: ticket.epoch,
        delegateSharedSpawn: (sessionId: string) => delegateForTicket(ticket.id, sessionId),
      }))
      outcome = (operation.op === 'stop' || operation.op === 'resume')
        && (result === false || (!!result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false))
        ? 'retryable'
        : 'committed'
      return result
    } finally {
      finishTicket(ticket.id, outcome)
    }
  }

  const authorizeHttpOperation = async ({ authenticated, projectMatches, headers, operation }: { authenticated: boolean; projectMatches: boolean; headers: Record<string, string>; operation: Operation }): Promise<Authorization | undefined> => {
    if (!authenticated) fail('unauthorized', 'authentication is required before maintenance admission')
    if (!projectMatches) fail('project_mismatch', 'request project does not match the maintenance project')
    const token = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-spexcode-session-maintenance')?.[1] ?? ''
    return locked((state) => {
      if (!token) {
        if (state.state === 'active') fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
        return undefined
      }
      if (state.state !== 'active') fail('maintenance_conflict', 'maintenance lease is not active', { state: state.state, epoch: state.epoch })
      if (!presentedTokenMatches(token, state.tokenHash)) fail('maintenance_token_invalid', 'maintenance bearer is missing, wrong, or stale', { state: state.state, epoch: state.epoch })
      const entry = capabilityFor(state, operation)
      if (!entry) return fail('maintenance_capability_missing', 'operation is not in the exact maintenance capability plan', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
      if (entry.state !== 'unused') fail('maintenance_capability_used', 'maintenance capability is already inflight, committed, or indeterminate', { state: state.state, epoch: state.epoch, operation: operation.op, sessionId: operationSession(operation) })
      return { token, epoch: state.epoch }
    })
  }

  const beginExternalOperation = (operation: Operation, owner: ProcessIdentity): string => {
    if (identityState(owner) !== 'live') fail('maintenance_invalid', 'external operation owner is not exact and live')
    return beginOperationTicket(operation, owner).id
  }
  const finishExternalOperation = (ticketId: string, owner: ProcessIdentity): void => locked((state, dirty) => {
    const index = state.tickets.findIndex((ticket) => ticket.id === ticketId && sameIdentity(ticket.owner, owner))
    if (index < 0) return
    state.tickets.splice(index, 1)
    dirty()
  })

  return {
    headerName: 'X-SpexCode-Session-Maintenance',
    runOperation, runOperationSync, acquireLease, heartbeatLease, releaseLease, readState, authorizeHttpOperation,
    beginExternalOperation, finishExternalOperation,
  }
}

function productionProcessIdentity(pid: number): ProcessReading {
  try { process.kill(pid, 0) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return null
    return 'ambiguous'
  }
  const startToken = processStartToken(pid)
  return startToken ? { pid, startToken } : 'ambiguous'
}

export function exactProcessIdentity(pid: number): ProcessIdentity | null {
  const reading = productionProcessIdentity(pid)
  return reading && reading !== 'ambiguous' ? reading : null
}

const coordinators = new Map<string, ReturnType<typeof createSessionMaintenance>>()
export function sessionMaintenance(root = projectRuntimeRoot()): ReturnType<typeof createSessionMaintenance> {
  let coordinator = coordinators.get(root)
  if (coordinator) return coordinator
  const detectedStart = processStartToken(process.pid)
  if (!detectedStart) throw new SessionMaintenanceError('maintenance_identity_unknown', `cannot read exact process identity for ${process.pid}`)
  const selfStart: string = detectedStart
  coordinator = createSessionMaintenance({
    runtimeRoot: root,
    now: () => Date.now(),
    randomBytes: cryptoRandomBytes,
    processIdentity: productionProcessIdentity,
    selfIdentity: () => ({ pid: process.pid, startToken: selfStart }),
    ticketReportMs: 30_000,
  })
  coordinators.set(root, coordinator)
  return coordinator
}

export const runSessionOperation = <T>(operation: Operation, body: (ticket: MaintenanceTicket) => Promise<T> | T): Promise<T> =>
  sessionMaintenance().runOperation(operation, body)
export const runSessionOperationSync = <T>(operation: Operation, body: (ticket: MaintenanceTicket) => T): T =>
  sessionMaintenance().runOperationSync(operation, body)

export function maintenanceBrokerDescriptors(): { request: number; response: number; turn: number } | null {
  const values = (process.env.SPEXCODE_MAINTENANCE_BROKER_FDS || '').split(',').map(Number)
  if (values.length !== 3 || values.some((fd) => !Number.isInteger(fd) || fd < 3) || new Set(values).size !== 3) return null
  return { request: values[0], response: values[1], turn: values[2] }
}

export function maintenanceErrorPayload(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof SessionMaintenanceError)) return null
  return {
    error: error.message,
    code: error.code,
    ...(error.state ? { state: error.state } : {}),
    ...(error.epoch !== undefined ? { epoch: error.epoch } : {}),
    ...(error.operation ? { operation: error.operation } : {}),
    ...(error.sessionId ? { sessionId: error.sessionId } : {}),
  }
}
