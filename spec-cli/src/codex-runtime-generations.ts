import { createHash, randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { processStartToken, verifyDetachedRuntime } from './process-identity.js'

export type CodexGenerationEndpoint = Readonly<{
  id: string
  pidFile: string
  receiptFile: string
  logFile: string
  socketPath: string
}>

type CodexGenerationState = 'current' | 'draining' | 'reclaimed' | 'starting'
type GenerationReservation = Readonly<{ pid: number; startToken: string }>
type CodexGeneration = Readonly<{ state: CodexGenerationState; endpoint: CodexGenerationEndpoint; reservation?: GenerationReservation }>
type CodexGenerationBinding = Readonly<{ generationId: string; threadId: string }>

export type CodexGenerationLedger = Readonly<{
  version: 3
  revision: number
  current: string | null
  pending: string | null
  generations: Record<string, CodexGeneration>
  bindings: Record<string, CodexGenerationBinding>
}>

const generationsDir = (root: string) => join(root, 'codex-app-server-generations')
const ledgerPath = (root: string) => join(root, 'codex-app-server-generations.json')
const lockPath = (root: string) => join(root, 'codex-app-server-generations.lock')
const lockOwnerPath = (root: string) => join(lockPath(root), 'owner.json')
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function codexGenerationSocketPath(root: string, generationId?: string): string {
  const base = process.env.SPEXCODE_CODEX_SOCKET_DIR || join(tmpdir(), `spexcode-cx-${process.getuid?.() ?? 0}`)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  // No suffix preserves the deployed legacy location. Every detached-v3 generation has an independent socket.
  const key = generationId ? `${root}\0${generationId}` : root
  return join(base, `spexcode-cx-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.sock`)
}

export function legacyCodexGenerationEndpoint(root: string): CodexGenerationEndpoint {
  return Object.freeze({
    id: 'legacy',
    pidFile: join(root, 'codex-app-server.pid'),
    receiptFile: join(root, 'codex-app-server.detached.json'),
    logFile: join(root, 'codex-app-server.log'),
    socketPath: codexGenerationSocketPath(root),
  })
}

function newEndpoint(root: string, id = `detached-v3-${randomUUID()}`): CodexGenerationEndpoint {
  const dir = join(generationsDir(root), id)
  return Object.freeze({
    id,
    pidFile: join(dir, 'pid'),
    receiptFile: join(dir, 'detached.json'),
    logFile: join(dir, 'app-server.log'),
    socketPath: codexGenerationSocketPath(root, id),
  })
}

const emptyLedger = (): CodexGenerationLedger => Object.freeze({ version: 3, revision: 0, current: null, pending: null, generations: {}, bindings: {} })

function isEndpoint(value: unknown): value is CodexGenerationEndpoint {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CodexGenerationEndpoint>
  return typeof candidate.id === 'string' && typeof candidate.pidFile === 'string' && typeof candidate.receiptFile === 'string' &&
    typeof candidate.logFile === 'string' && typeof candidate.socketPath === 'string'
}

function isReservation(value: unknown): value is GenerationReservation {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GenerationReservation>
  return Number.isInteger(candidate.pid) && candidate.pid! > 0 && typeof candidate.startToken === 'string' && !!candidate.startToken
}

function parseLedger(value: unknown): CodexGenerationLedger {
  if (!value || typeof value !== 'object') throw new Error('Codex generation ledger is malformed')
  const raw = value as Partial<CodexGenerationLedger>
  if (raw.version !== 3 || !Number.isSafeInteger(raw.revision) || raw.revision! < 0 ||
    (raw.current !== null && typeof raw.current !== 'string') || (raw.pending !== null && typeof raw.pending !== 'string') ||
    !raw.generations || typeof raw.generations !== 'object' || !raw.bindings || typeof raw.bindings !== 'object') {
    throw new Error('Codex generation ledger has the wrong detached-v3 shape')
  }
  for (const [id, generation] of Object.entries(raw.generations)) {
    if (!generation || typeof generation !== 'object' || !['current', 'draining', 'reclaimed', 'starting'].includes((generation as CodexGeneration).state) ||
      !isEndpoint((generation as CodexGeneration).endpoint) || (generation as CodexGeneration).endpoint.id !== id ||
      ((generation as CodexGeneration).state === 'starting' && !isReservation((generation as CodexGeneration).reservation))) {
      throw new Error(`Codex generation ledger has malformed generation ${id}`)
    }
  }
  for (const [sessionId, binding] of Object.entries(raw.bindings)) {
    if (!binding || typeof binding !== 'object' || typeof (binding as CodexGenerationBinding).generationId !== 'string' ||
      typeof (binding as CodexGenerationBinding).threadId !== 'string' || !(binding as CodexGenerationBinding).threadId) {
      throw new Error(`Codex generation ledger has malformed binding ${sessionId}`)
    }
  }
  return raw as CodexGenerationLedger
}

export function readCodexGenerationLedger(root: string): CodexGenerationLedger {
  if (!existsSync(ledgerPath(root))) return emptyLedger()
  return parseLedger(JSON.parse(readFileSync(ledgerPath(root), 'utf8')))
}

type LedgerWrite = Omit<CodexGenerationLedger, 'revision' | 'version'>
function writeLedger(root: string, previous: CodexGenerationLedger, next: LedgerWrite): CodexGenerationLedger {
  const observed = readCodexGenerationLedger(root)
  if (observed.revision !== previous.revision) throw new Error('Codex generation ledger CAS lost; retry')
  const value: CodexGenerationLedger = {
    ...next,
    version: 3,
    revision: previous.revision + 1,
  }
  mkdirSync(dirname(ledgerPath(root)), { recursive: true, mode: 0o700 })
  const temp = `${ledgerPath(root)}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, ledgerPath(root))
  return value
}

type LedgerLockOwner = Readonly<{ pid: number; startToken: string }>

function ledgerLockOwner(root: string): LedgerLockOwner | null {
  try {
    const value: unknown = JSON.parse(readFileSync(lockOwnerPath(root), 'utf8'))
    return isReservation(value) ? value : null
  } catch { return null }
}

function staleLedgerLock(root: string): boolean {
  const owner = ledgerLockOwner(root)
  if (owner) return processStartToken(owner.pid) !== owner.startToken
  // A creator publishes owner.json immediately after mkdir. A short grace avoids mistaking that tiny window
  // for an abandoned lock, while a crashed creator remains recoverable instead of wedging every retry.
  try { return Date.now() - statSync(lockPath(root)).mtimeMs > 500 }
  catch { return false }
}

function acquireLedgerLock(root: string, timeoutMs: number, pause: () => void | Promise<void>): void | Promise<void> {
  const lock = lockPath(root)
  const token = processStartToken(process.pid)
  if (!token) throw new Error('cannot prove coordinator process identity for Codex generation ledger lock')
  const deadline = Date.now() + timeoutMs
  const attempt = (): void | Promise<void> => {
    for (;;) {
      try {
        mkdirSync(lock, { mode: 0o700 })
        try { writeFileSync(lockOwnerPath(root), `${JSON.stringify({ pid: process.pid, startToken: token })}\n`, { mode: 0o600 }) }
        catch (error) { rmSync(lock, { recursive: true, force: true }); throw error }
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (staleLedgerLock(root)) {
          rmSync(lock, { recursive: true, force: true })
          continue
        }
        if (Date.now() >= deadline) throw new Error('Codex generation ledger lock is busy; retry')
        const next = pause()
        if (next instanceof Promise) return next.then(attempt)
      }
    }
  }
  return attempt()
}

async function withLedgerLock<T>(root: string, body: () => Promise<T>): Promise<T> {
  await acquireLedgerLock(root, 10_000, () => sleep(25))
  try { return await body() }
  finally { rmSync(lockPath(root), { recursive: true, force: true }) }
}

function withLedgerLockSync<T>(root: string, body: () => T): T {
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  const acquired = acquireLedgerLock(root, 5_000, () => { Atomics.wait(sleeper, 0, 0, 10) })
  if (acquired instanceof Promise) throw new Error('synchronous Codex generation ledger lock acquisition became asynchronous')
  try { return body() }
  finally { rmSync(lockPath(root), { recursive: true, force: true }) }
}

type EndpointIdentity = { pid: number; token: string; socketDev: number; socketIno: number }

function endpointIdentity(endpoint: CodexGenerationEndpoint): EndpointIdentity | null {
  try {
    const pid = Number(readFileSync(endpoint.pidFile, 'utf8').trim())
    const detached = verifyDetachedRuntime(pid, endpoint.receiptFile)
    const socket = statSync(endpoint.socketPath)
    if (!detached.ok || !socket.isSocket()) return null
    return {
      pid,
      token: `${detached.identity.pid}|${detached.identity.startToken}|${detached.identity.processGroupId}|${detached.identity.linuxSessionId ?? '-'}`,
      socketDev: socket.dev,
      socketIno: socket.ino,
    }
  } catch { return null }
}

function hasLegacyResidue(root: string): boolean {
  const endpoint = legacyCodexGenerationEndpoint(root)
  return [endpoint.pidFile, endpoint.receiptFile, endpoint.socketPath].some(existsSync)
}

function bootstrapBindings(root: string, generationId: string): Record<string, CodexGenerationBinding> {
  const result: Record<string, CodexGenerationBinding> = {}
  const sessions = join(root, 'sessions')
  let ids: string[] = []
  try { ids = readdirSync(sessions) } catch { return result }
  for (const sessionId of ids) {
    try {
      const record = JSON.parse(readFileSync(join(sessions, sessionId, 'session.json'), 'utf8')) as Record<string, unknown>
      const harness = record.harness
      const threadId = record.harness_session_id
      if (record.governed === true && (harness === 'codex' || harness === 'codex-headless') && typeof threadId === 'string' && threadId) {
        result[sessionId] = { generationId, threadId }
      }
    } catch { /* unreadable records remain unbound and fail loud at use */ }
  }
  return result
}

function bootstrapLedger(root: string): CodexGenerationLedger {
  const legacy = legacyCodexGenerationEndpoint(root)
  if (!hasLegacyResidue(root)) return emptyLedger()
  if (!endpointIdentity(legacy)) throw new Error('legacy Codex root is present but its exact detached PID/start/receipt/socket identity is unproven')
  return {
    version: 3,
    revision: 0,
    current: null,
    pending: null,
    generations: { [legacy.id]: { state: 'draining', endpoint: legacy } },
    bindings: bootstrapBindings(root, legacy.id),
  }
}

async function waitForEndpoint(endpoint: CodexGenerationEndpoint, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (endpointIdentity(endpoint)) {
      const listening = await new Promise<boolean>((resolve) => {
        let settled = false
        const done = (value: boolean) => { if (!settled) { settled = true; client?.destroy(); resolve(value) } }
        let client: Socket | null = null
        try { client = createConnection(endpoint.socketPath) }
        catch { return resolve(false) }
        client.once('connect', () => done(true))
        client.once('error', () => done(false))
      })
      if (listening) return true
    }
    await sleep(25)
  }
  return false
}

type EnsureAction =
  | { kind: 'start'; endpoint: CodexGenerationEndpoint }
  | { kind: 'publish'; endpoint: CodexGenerationEndpoint }
  | { kind: 'wait' }
  | { kind: 'current'; endpoint: CodexGenerationEndpoint }

function publishPendingGeneration(root: string, endpoint: CodexGenerationEndpoint): Promise<CodexGenerationEndpoint> {
  return withLedgerLock(root, async () => {
    const previous = readCodexGenerationLedger(root)
    if (previous.current) {
      const current = previous.generations[previous.current]
      if (!current || current.state !== 'current' || !endpointIdentity(current.endpoint))
        throw new Error('another Codex generation switch published an unproven current endpoint')
      return current.endpoint
    }
    if (previous.pending !== endpoint.id || !endpointIdentity(endpoint))
      throw new Error('Codex generation switch CAS lost or candidate identity changed before publication')
    const generations = {
      ...previous.generations,
      [endpoint.id]: { state: 'current' as const, endpoint },
    }
    writeLedger(root, previous, { current: endpoint.id, pending: null, generations, bindings: previous.bindings })
    return endpoint
  })
}

export async function ensureCodexCurrentGeneration(root: string, start: (endpoint: CodexGenerationEndpoint) => Promise<void>): Promise<CodexGenerationEndpoint> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const action = await withLedgerLock(root, async (): Promise<EnsureAction> => {
      let previous = readCodexGenerationLedger(root)
      if (previous.revision === 0 && !existsSync(ledgerPath(root))) {
        const bootstrapped = bootstrapLedger(root)
        previous = writeLedger(root, previous, bootstrapped)
      }
      if (previous.current) {
        const generation = previous.generations[previous.current]
        if (!generation || generation.state !== 'current' || !endpointIdentity(generation.endpoint))
          throw new Error('canonical Codex generation is missing, replaced, or unproven; refusing to route new traffic')
        return { kind: 'current', endpoint: generation.endpoint }
      }
      if (previous.pending) {
        const pending = previous.generations[previous.pending]
        if (!pending || pending.state !== 'starting') throw new Error('Codex generation ledger pending switch is malformed')
        // A coordinator can crash after the detached endpoint proves live but before the CAS publish. The
        // durable pending record is sufficient for any later coordinator to complete that same switch.
        if (endpointIdentity(pending.endpoint)) return { kind: 'publish', endpoint: pending.endpoint }
        if (pending.reservation && processStartToken(pending.reservation.pid) === pending.reservation.startToken)
          return { kind: 'wait' }
        const generations = { ...previous.generations }
        delete generations[pending.endpoint.id]
        writeLedger(root, previous, { current: null, pending: null, generations, bindings: previous.bindings })
      }
      const latest = readCodexGenerationLedger(root)
      const endpoint = newEndpoint(root)
      const startToken = processStartToken(process.pid)
      if (!startToken) throw new Error('cannot prove coordinator process identity for Codex generation reservation')
      mkdirSync(dirname(endpoint.pidFile), { recursive: true, mode: 0o700 })
      writeLedger(root, latest, {
        current: latest.current,
        pending: endpoint.id,
        generations: { ...latest.generations, [endpoint.id]: { state: 'starting', endpoint, reservation: { pid: process.pid, startToken } } },
        bindings: latest.bindings,
      })
      return { kind: 'start', endpoint }
    })
    if (action.kind === 'current') return action.endpoint
    if (action.kind === 'publish') return publishPendingGeneration(root, action.endpoint)
    if (action.kind === 'wait') {
      if (Date.now() >= deadline) throw new Error('Codex generation switch reservation owner is still live but did not publish; retry after it exits')
      await sleep(50)
      continue
    }
    try { await start(action.endpoint) }
    catch (error) {
      await withLedgerLock(root, async () => {
        const previous = readCodexGenerationLedger(root)
        if (previous.pending !== action.endpoint.id) return
        if (endpointIdentity(action.endpoint)) return
        const generations = { ...previous.generations }
        delete generations[action.endpoint.id]
        writeLedger(root, previous, { current: previous.current, pending: null, generations, bindings: previous.bindings })
      })
      throw error
    }
    if (!await waitForEndpoint(action.endpoint)) {
      await withLedgerLock(root, async () => {
        const previous = readCodexGenerationLedger(root)
        if (previous.pending !== action.endpoint.id || endpointIdentity(action.endpoint)) return
        const generations = { ...previous.generations }
        delete generations[action.endpoint.id]
        writeLedger(root, previous, { current: previous.current, pending: null, generations, bindings: previous.bindings })
      })
      throw new Error(`candidate Codex generation ${action.endpoint.id} did not prove a live detached endpoint; current pointer was not switched`)
    }
    return publishPendingGeneration(root, action.endpoint)
  }
}

export function bindCodexGeneration(root: string, sessionId: string, threadId: string, generationId: string | null): void {
  withLedgerLockSync(root, () => {
    const previous = readCodexGenerationLedger(root)
    if (generationId === null && previous.revision === 0 && !previous.current && !Object.keys(previous.generations).length) return
    const bindings = { ...previous.bindings }
    if (generationId === null) delete bindings[sessionId]
    else {
      const generation = previous.generations[generationId]
      if (!generation || generation.state === 'reclaimed') throw new Error(`Codex generation ${generationId} is absent or reclaimed`)
      bindings[sessionId] = { generationId, threadId }
    }
    writeLedger(root, previous, { current: previous.current, pending: previous.pending, generations: previous.generations, bindings })
  })
}

export function resolveCodexGenerationForSession(root: string, sessionId: string, threadId: string): CodexGenerationEndpoint | null {
  const ledger = readCodexGenerationLedger(root)
  const binding = ledger.bindings[sessionId]
  if (!binding || binding.threadId !== threadId) return null
  const generation = ledger.generations[binding.generationId]
  return generation && generation.state !== 'reclaimed' ? generation.endpoint : null
}

export function codexGenerationBindingForSession(root: string, sessionId: string): CodexGenerationBinding | null {
  return readCodexGenerationLedger(root).bindings[sessionId] ?? null
}

export function currentCodexGeneration(root: string): CodexGenerationEndpoint | null {
  const ledger = readCodexGenerationLedger(root)
  const generation = ledger.current ? ledger.generations[ledger.current] : null
  return generation?.state === 'current' ? generation.endpoint : null
}

export function codexGenerationEndpoints(root: string): CodexGenerationEndpoint[] {
  return Object.values(readCodexGenerationLedger(root).generations)
    .filter((generation) => generation.state !== 'reclaimed')
    .map((generation) => generation.endpoint)
}

export async function reclaimDrainingCodexGeneration(
  root: string,
  generationId: string,
  census: (endpoint: CodexGenerationEndpoint) => Promise<{ healthy: boolean; referenceIds: string[]; peerCount: number }>,
): Promise<{ reclaimed: boolean; reason: string }> {
  return withLedgerLock(root, async () => {
    const previous = readCodexGenerationLedger(root)
    const generation = previous.generations[generationId]
    if (!generation) return { reclaimed: false, reason: 'generation is absent' }
    if (generation.state === 'reclaimed') return { reclaimed: true, reason: 'generation is already reclaimed' }
    if (generation.state !== 'draining') return { reclaimed: false, reason: 'only draining generations may be reclaimed' }
    const identity = endpointIdentity(generation.endpoint)
    if (!identity) return { reclaimed: false, reason: 'exact PID/start/receipt/socket identity is unproven' }
    const bound = Object.values(previous.bindings).filter((binding) => binding.generationId === generationId)
    if (bound.length) return { reclaimed: false, reason: `generation retains ${bound.length} governed binding(s)` }
    const before = await census(generation.endpoint)
    if (!before.healthy) return { reclaimed: false, reason: 'native reference census is unhealthy' }
    if (before.referenceIds.length || before.peerCount) return { reclaimed: false, reason: `generation retains ${before.referenceIds.length} loaded references and ${before.peerCount} peers` }
    const again = endpointIdentity(generation.endpoint)
    if (!again || again.token !== identity.token || again.socketDev !== identity.socketDev || again.socketIno !== identity.socketIno)
      return { reclaimed: false, reason: 'generation identity changed during reclaim guard' }
    const after = await census(generation.endpoint)
    if (!after.healthy || after.referenceIds.length || after.peerCount)
      return { reclaimed: false, reason: 'generation reference census changed during reclaim guard' }
    try { process.kill(identity.pid, 'SIGTERM') }
    catch (error) { return { reclaimed: false, reason: `could not stop exact drained generation: ${(error as Error).message}` } }
    for (let attempt = 0; attempt < 100 && processStartToken(identity.pid); attempt++) await sleep(20)
    if (processStartToken(identity.pid)) return { reclaimed: false, reason: 'exact drained generation did not exit after SIGTERM' }
    const generations = { ...previous.generations, [generationId]: { state: 'reclaimed' as const, endpoint: generation.endpoint } }
    writeLedger(root, previous, { current: previous.current, pending: previous.pending, generations, bindings: previous.bindings })
    return { reclaimed: true, reason: 'exact drained generation reclaimed after zero-reference census' }
  })
}
