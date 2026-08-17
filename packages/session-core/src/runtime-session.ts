import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isSessionLifecycle,
  isSessionProposal,
  listSessionIds,
  readRecordEntry,
  sessionArtifactPath,
  sessionRecordPath,
  sessionStoreDir,
  type RawRecord,
  type SessionLifecycle,
  type SessionProposal,
} from '@spexcode/spec-core'
import { enqueue, ensurePendingWhileLocked, withDeliveryLocks, type PendingMessage } from './delivery-queue.js'
import { withSessionRecordLocks } from './record-lock.js'
import { appendSent, recordStatus, sentDispatchReceipt, type SentDispatchReceipt } from './session-timeline.js'

export type RuntimeSessionRegistration = {
  sessionId: string
  runtimeOwner: string
  worktreePath: string
  branch: string | null
  parentSessionId?: string | null
  title?: string | null
  node?: string | null
  createdAt?: number
}

export type RuntimeSessionState = {
  sessionId: string
  runtimeOwner: string
  revision: string
  runtimeState: string
  lifecycle: SessionLifecycle
  proposal?: SessionProposal | null
  note?: string | null
}

export type RuntimeSessionRecord = {
  sessionId: string
  runtimeOwner: string
  runtimeState: string | null
  revision: string | null
  worktreePath: string
  branch: string | null
  parentSessionId: string | null
  title: string | null
  node: string | null
  lifecycle: SessionLifecycle
  proposal: SessionProposal | null
  note: string | null
  createdAt: number
}

type WatchEntry = {
  watcher: string
  createdAt: string
  sources: ('manual' | 'parent')[]
  snapshotPending?: string
}

export class RuntimeSessionConflict extends Error {
  readonly code = 'runtime_session_conflict'
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSessionConflict'
  }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const watchPath = (target: string): string => sessionArtifactPath(target, 'watchers.json')

function scalar(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new RuntimeSessionConflict(`${field} must be a non-empty string`)
  return normalized
}

function readRaw(id: string): RawRecord | null {
  const entry = readRecordEntry(id)
  if (entry.kind === 'absent') return null
  if (entry.kind === 'corrupt') throw new RuntimeSessionConflict(`session ${id} record is corrupt: ${entry.error}`)
  return entry.raw
}

function runtimeRecord(raw: RawRecord): RuntimeSessionRecord {
  const runtimeOwner = raw.runtime_owner?.trim()
  if (!runtimeOwner) throw new RuntimeSessionConflict(`session ${raw.session_id} is not owned by an external runtime`)
  if (!isSessionLifecycle(raw.status)) throw new RuntimeSessionConflict(`session ${raw.session_id} has invalid lifecycle ${JSON.stringify(raw.status)}`)
  if (!(raw.proposal == null || raw.proposal === '' || isSessionProposal(raw.proposal)))
    throw new RuntimeSessionConflict(`session ${raw.session_id} has invalid proposal ${JSON.stringify(raw.proposal)}`)
  return {
    sessionId: raw.session_id,
    runtimeOwner,
    runtimeState: raw.runtime_state?.trim() || null,
    revision: raw.runtime_revision?.trim() || null,
    worktreePath: raw.worktree_path,
    branch: raw.branch || null,
    parentSessionId: raw.parent || null,
    title: raw.title || null,
    node: raw.node || null,
    lifecycle: raw.status,
    proposal: isSessionProposal(raw.proposal) ? raw.proposal : null,
    note: raw.note || null,
    createdAt: Number(raw.createdAt) || 0,
  }
}

function writeRaw(raw: RawRecord): void {
  const dir = sessionStoreDir(raw.session_id)
  mkdirSync(dir, { recursive: true })
  const path = sessionRecordPath(raw.session_id)
  const tmp = join(dir, `.session.json.${process.pid}.${randomUUID()}.tmp`)
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n')
  renameSync(tmp, path)
}

function readWatches(target: string): WatchEntry[] {
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(watchPath(target), 'utf8')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new RuntimeSessionConflict(`session ${target} watch record is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!Array.isArray(parsed)) throw new RuntimeSessionConflict(`session ${target} watch record is not an array`)
  return parsed.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new RuntimeSessionConflict(`session ${target} watch row ${index} is invalid`)
    const row = candidate as Partial<WatchEntry>
    if (typeof row.watcher !== 'string' || typeof row.createdAt !== 'string' || !Array.isArray(row.sources)
      || row.sources.some((source) => source !== 'manual' && source !== 'parent')
      || (row.snapshotPending !== undefined && typeof row.snapshotPending !== 'string'))
      throw new RuntimeSessionConflict(`session ${target} watch row ${index} is invalid`)
    return row as WatchEntry
  })
}

function writeWatches(target: string, entries: WatchEntry[]): void {
  const dir = sessionStoreDir(target)
  mkdirSync(dir, { recursive: true })
  const path = watchPath(target)
  const tmp = join(dir, `.watchers.json.${process.pid}.${randomUUID()}.tmp`)
  writeFileSync(tmp, JSON.stringify(entries, null, 2) + '\n')
  renameSync(tmp, path)
}

function registrationRaw(input: RuntimeSessionRegistration): RawRecord {
  const sessionId = scalar(input.sessionId, 'sessionId')
  const runtimeOwner = scalar(input.runtimeOwner, 'runtimeOwner')
  return {
    session_id: sessionId,
    governed: false,
    worktree_path: scalar(input.worktreePath, 'worktreePath'),
    branch: input.branch ?? '',
    node: input.node?.trim() || '',
    title: input.title?.trim() || '',
    name: '',
    parent: input.parentSessionId?.trim() || '',
    status: 'active',
    proposal: '',
    merges: 0,
    note: '',
    sortkey: null,
    createdAt: input.createdAt ?? Date.now(),
    harness: runtimeOwner,
    harness_session_id: sessionId,
    stopped: false,
    archived: false,
    cold_proof: '',
    adapter_recovery: '',
    launcher: '',
    launch_cmd: '',
    create_request_id: '',
    create_payload_hash: '',
    runtime_owner: runtimeOwner,
    runtime_state: 'registered',
    runtime_revision: '',
    launch_readiness_pending: '',
  }
}

function sameRegistration(raw: RawRecord, input: RuntimeSessionRegistration): boolean {
  return raw.runtime_owner === input.runtimeOwner.trim()
    && raw.worktree_path === input.worktreePath.trim()
    && (raw.branch || null) === (input.branch || null)
    && (raw.parent || null) === (input.parentSessionId?.trim() || null)
}

export async function registerRuntimeSession(input: RuntimeSessionRegistration): Promise<{ replayed: boolean }> {
  const id = scalar(input.sessionId, 'sessionId')
  const parent = input.parentSessionId?.trim() || null
  return withSessionRecordLocks([id, ...(parent ? [parent] : [])], async () => {
    if (parent) {
      const parentRaw = readRaw(parent)
      if (!parentRaw) throw new RuntimeSessionConflict(`parent runtime session ${parent} is not registered`)
      if (parentRaw.runtime_owner !== input.runtimeOwner.trim())
        throw new RuntimeSessionConflict(`parent runtime session ${parent} belongs to another runtime`)
    }
    const existing = readRaw(id)
    if (existing) {
      if (!sameRegistration(existing, input)) throw new RuntimeSessionConflict(`session ${id} is already registered with different runtime coordinates`)
      return { replayed: true }
    }
    writeRaw(registrationRaw(input))
    if (parent) writeWatches(id, [{
      watcher: parent,
      createdAt: new Date().toISOString(),
      sources: ['parent'],
      snapshotPending: randomUUID(),
    }])
    return { replayed: false }
  })
}

function stateMessage(record: RuntimeSessionRecord): string {
  const proposal = record.lifecycle === 'awaiting' && record.proposal ? `/${record.proposal}` : ''
  const note = record.note ? ` — ${record.note}` : ''
  return `[spex watch] ${record.sessionId} is ${record.runtimeState ?? record.lifecycle}${proposal}${note}`
}

function pendingFor(receipt: SentDispatchReceipt, mid: string): PendingMessage {
  return {
    mid,
    text: receipt.delivery!.text,
    from: receipt.delivery!.from,
    dispatch: { operation: receipt.operation, requestDigest: receipt.requestDigest },
  }
}

export async function publishRuntimeSessionState(input: RuntimeSessionState): Promise<{ notified: string[]; replayed: boolean }> {
  const id = scalar(input.sessionId, 'sessionId')
  const owner = scalar(input.runtimeOwner, 'runtimeOwner')
  const revision = scalar(input.revision, 'revision')
  const runtimeState = scalar(input.runtimeState, 'runtimeState')
  const initial = readRaw(id)
  if (!initial) throw new RuntimeSessionConflict(`runtime session ${id} is not registered`)
  const watchers = readWatches(id).map((entry) => entry.watcher)
  return withSessionRecordLocks([id, ...watchers], async () => withDeliveryLocks(watchers, async () => {
    const raw = readRaw(id)
    if (!raw) throw new RuntimeSessionConflict(`runtime session ${id} disappeared during publication`)
    if (raw.runtime_owner !== owner) throw new RuntimeSessionConflict(`runtime session ${id} belongs to ${raw.runtime_owner || 'no external runtime'}, not ${owner}`)
    const proposal = input.proposal ?? null
    const note = input.note ?? null
    const sameRevision = raw.runtime_revision === revision
    const sameState = raw.runtime_state === runtimeState && raw.status === input.lifecycle
      && (raw.proposal || null) === proposal && (raw.note || null) === note
    if (sameRevision && !sameState) throw new RuntimeSessionConflict(`runtime revision ${revision} for session ${id} is already bound to another state`)
    const replayed = sameRevision
    if (!sameRevision) {
      writeRaw({
        ...raw,
        status: input.lifecycle,
        proposal: proposal ?? '',
        note: note ?? '',
        runtime_state: runtimeState,
        runtime_revision: revision,
      })
      recordStatus(id, input.lifecycle, proposal, note)
    }
    const current = runtimeRecord(readRaw(id)!)
    const message = stateMessage(current)
    const notified: string[] = []
    for (const watcher of watchers) {
      const operation = `runtime-state:${id}`
      const requestDigest = digest(`${id}\0${watcher}\0${revision}`)
      const payloadHash = digest(`${operation}\0${requestDigest}\0${message}`)
      const receipt: SentDispatchReceipt = {
        operation,
        requestDigest,
        payloadHash,
        delivery: { text: message, from: id },
      }
      const prior = sentDispatchReceipt(watcher, operation, requestDigest)
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new RuntimeSessionConflict(`runtime revision ${revision} notification is already bound to different bytes`)
        if (!prior.delivered) ensurePendingWhileLocked(watcher, pendingFor(receipt, prior.mid))
      } else {
        const { mid } = appendSent(watcher, message, id, undefined, receipt)
        enqueue(watcher, pendingFor(receipt, mid))
      }
      notified.push(watcher)
    }
    const entries = readWatches(id)
    if (entries.some((entry) => entry.snapshotPending)) {
      writeWatches(id, entries.map(({ snapshotPending: _pending, ...entry }) => entry))
    }
    return { notified, replayed }
  }))
}

export function readRuntimeSession(sessionId: string): RuntimeSessionRecord | null {
  const raw = readRaw(scalar(sessionId, 'sessionId'))
  return raw?.runtime_owner ? runtimeRecord(raw) : null
}

export function runtimeSessionChildren(parentSessionId: string, runtimeOwner?: string): RuntimeSessionRecord[] {
  const parent = scalar(parentSessionId, 'parentSessionId')
  return listSessionIds().flatMap((id) => {
    const record = readRuntimeSession(id)
    if (!record || record.parentSessionId !== parent || (runtimeOwner && record.runtimeOwner !== runtimeOwner)) return []
    return [record]
  }).sort((left, right) => left.createdAt - right.createdAt || left.sessionId.localeCompare(right.sessionId))
}
