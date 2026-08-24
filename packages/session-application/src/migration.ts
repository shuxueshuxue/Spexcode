import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { openProjectSessionApplication, type LocalityPrecondition } from './production.js'
import { encodeEventJson } from '@spexcode/session-events'

const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/
const STATUS = /^[0-9A-Za-z._:-]{1,64}$/
const VERSION = 1

export interface JsonMigrationRecord {
  session_id: string
  status: string
  parent?: string | null
  createdAt?: number
  [key: string]: unknown
}

interface WatchEntry {
  watcher: string
  createdAt: string
  sources: ('manual' | 'parent')[]
  snapshotPending?: string
}

type LegacyTimelineEvent =
  | { kind: 'status'; ts?: string; status?: string; proposal?: string | null; note?: string | null }
  | { kind: 'sent'; ts?: string; mid?: string; text?: string; from?: string | null; replyVia?: 'note' }

interface LegacyPendingMessage {
  mid: string
  text: string
  from: string | null
  attributes?: Record<string, string>
  dispatch?: { operation: string; requestDigest: string }
}

interface LegacyArtifacts {
  timeline: LegacyTimelineEvent[]
  pending: LegacyPendingMessage[]
}

export interface JsonSessionMigrationOptions {
  databasePath: string
  recordsRoot: string
  locality: LocalityPrecondition
  backupRoot?: string
  now?: () => number
  orphanParentPolicy?: 'fail' | 'tombstone'
}

/** The durable fence shared by the one-time importer and legacy JSON writers. */
export function jsonMigrationFencePath(recordsRoot: string): string {
  return join(recordsRoot, '.json-migration.lock')
}

export interface JsonSessionMigrationReport {
  version: number
  sourceDigest: string
  records: number
  parentEdges: number
  watchEdges: number
  events: number
  orphanParents: string[]
  backupRoot: string
  markerPath: string
  replayed: boolean
}

class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonSessionMigrationError'
  }
}

const fail = (message: string): never => { throw new MigrationError(message) }

function parseJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { fail(`cannot read JSON migration input ${path}: ${error instanceof Error ? error.message : String(error)}`) }
}

function readInputs(recordsRoot: string): { records: JsonMigrationRecord[]; watches: Map<string, WatchEntry[]>; artifacts: Map<string, LegacyArtifacts>; files: string[]; orphanParents: string[] } {
  if (!isAbsolute(recordsRoot)) fail('recordsRoot must be an absolute directory')
  if (!existsSync(recordsRoot)) return { records: [], watches: new Map(), artifacts: new Map(), files: [], orphanParents: [] }
  if (!statSync(recordsRoot).isDirectory()) fail(`recordsRoot is not a directory: ${recordsRoot}`)
  const dirs = readdirSync(recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const records: JsonMigrationRecord[] = []
  const watches = new Map<string, WatchEntry[]>()
  const artifacts = new Map<string, LegacyArtifacts>()
  const files: string[] = []
  const ids = new Set<string>()
  for (const id of dirs) {
    if (!SESSION_ID.test(id)) fail(`ambiguous session directory name: ${id}`)
    const dir = join(recordsRoot, id)
    const recordPath = join(dir, 'session.json')
    if (!existsSync(recordPath)) continue
    const raw = parseJson(recordPath)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`corrupt session record: ${recordPath}`)
    const record = raw as JsonMigrationRecord
    if (record.session_id !== id || typeof record.session_id !== 'string' || !SESSION_ID.test(record.session_id)) {
      fail(`ambiguous session id in ${recordPath}`)
    }
    if (typeof record.status !== 'string' || !STATUS.test(record.status)) fail(`invalid status in ${recordPath}`)
    if (record.parent !== undefined && record.parent !== null && record.parent !== '' && (typeof record.parent !== 'string' || !SESSION_ID.test(record.parent))) {
      fail(`invalid parent in ${recordPath}`)
    }
    if (record.createdAt !== undefined && (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0)) fail(`invalid createdAt in ${recordPath}`)
    if (ids.has(id)) fail(`duplicate session record: ${id}`)
    ids.add(id)
    // Empty was the legacy root marker; normalize it without changing the source digest.
    records.push(record.parent === '' ? { ...record, parent: null } : record)
    files.push(recordPath)
    const watchPath = join(dir, 'watchers.json')
    if (existsSync(watchPath)) {
      const parsed = parseJson(watchPath)
      if (!Array.isArray(parsed)) fail(`watchers file is not an array: ${watchPath}`)
      const seen = new Set<string>()
      const parsedArray = parsed as unknown[]
      const entries: WatchEntry[] = parsedArray.map((value: unknown, index: number) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid watcher row ${index} in ${watchPath}`)
        const row = value as Partial<WatchEntry>
        if (typeof row.watcher !== 'string' || !SESSION_ID.test(row.watcher) || typeof row.createdAt !== 'string' || !Array.isArray(row.sources)) {
          fail(`invalid watcher row ${index} in ${watchPath}`)
        }
        const sources = row.sources as unknown[]
        if (sources.some(source => source !== 'manual' && source !== 'parent') || new Set(sources).size !== sources.length) {
          fail(`ambiguous watcher sources in ${watchPath}`)
        }
        const watcher = row.watcher as string
        const createdAt = row.createdAt as string
        if (seen.has(watcher)) fail(`duplicate watcher ${watcher} in ${watchPath}`)
        seen.add(watcher)
        return { watcher, createdAt, sources: sources as ('manual' | 'parent')[], ...(row.snapshotPending === undefined ? {} : { snapshotPending: row.snapshotPending }) }
      })
      watches.set(id, entries)
      files.push(watchPath)
    }
    const artifactFiles = [
      join(dir, 'timeline.ndjson'),
      ...(() => {
        const timelineDir = join(dir, 'timeline')
        if (!existsSync(timelineDir) || !statSync(timelineDir).isDirectory()) return []
        return readdirSync(timelineDir).filter(name => /^\d+\.ndjson$/.test(name)).sort().map(name => join(timelineDir, name))
      })(),
      join(dir, 'pending.json'),
      join(dir, 'cursors.json'),
    ].filter(existsSync)
    const timeline: LegacyTimelineEvent[] = []
    for (const file of artifactFiles.filter(file => file.endsWith('.ndjson'))) {
      for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
        let parsed: unknown
        try { parsed = JSON.parse(line) } catch (error) { fail(`invalid legacy timeline line in ${file}: ${error instanceof Error ? error.message : String(error)}`) }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`invalid legacy timeline event in ${file}`)
        const event = parsed as Record<string, unknown>
        if (event.kind === 'dispatch-settled') continue
        if (event.kind !== 'status' && event.kind !== 'sent') fail(`unknown legacy timeline event kind in ${file}`)
        timeline.push(event as LegacyTimelineEvent)
      }
    }
    let pending: LegacyPendingMessage[] = []
    const pendingPath = join(dir, 'pending.json')
    if (existsSync(pendingPath)) {
      const parsed = parseJson(pendingPath)
      if (!Array.isArray(parsed)) fail(`legacy pending file is not an array: ${pendingPath}`)
      pending = (parsed as unknown[]).map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid legacy pending row ${index} in ${pendingPath}`)
        const row = value as Partial<LegacyPendingMessage>
        if (typeof row.mid !== 'string' || typeof row.text !== 'string' || (row.from !== null && typeof row.from !== 'string')) fail(`invalid legacy pending row ${index} in ${pendingPath}`)
        return row as LegacyPendingMessage
      })
    }
    if (timeline.length || pending.length) artifacts.set(id, { timeline, pending })
    files.push(...artifactFiles)
  }
  const byId = new Set(records.map(record => record.session_id))
  const orphanParents = [...new Set(records.flatMap(record => record.parent && !byId.has(record.parent) ? [record.parent] : []))].sort()
  for (const [target, entries] of watches) {
    for (const entry of entries) if (!byId.has(entry.watcher)) fail(`session ${target} names missing watcher ${entry.watcher}`)
  }
  // Parent pointers are a single rooted forest. Detect cycles before opening SQLite.
  for (const record of records) {
    const chain = new Set<string>()
    let current: string | null | undefined = record.session_id
    while (current) {
      if (chain.has(current)) fail(`parent cycle includes ${current}`)
      chain.add(current)
      current = records.find(candidate => candidate.session_id === current)?.parent
    }
  }
  return { records: records.sort((a, b) => a.session_id.localeCompare(b.session_id)), watches, artifacts, files: files.sort(), orphanParents }
}

function digestInputs(recordsRoot: string, files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) hash.update(file.slice(recordsRoot.length)).update('\0').update(readFileSync(file)).update('\0')
  return hash.digest('hex')
}

function backupInputs(recordsRoot: string, files: string[], backupRoot: string, digest: string): void {
  mkdirSync(backupRoot, { recursive: true })
  for (const file of files) {
    const relative = file.slice(recordsRoot.length).replace(/^[/\\]/, '')
    const destination = join(backupRoot, relative)
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination) && readFileSync(destination).compare(readFileSync(file)) !== 0) fail(`backup collision for ${relative}`)
    if (!existsSync(destination)) copyFileSync(file, destination)
  }
  const digestPath = join(backupRoot, 'source.sha256')
  if (existsSync(digestPath) && readFileSync(digestPath, 'utf8').trim() !== digest) fail('existing migration backup has a different source digest')
  if (!existsSync(digestPath)) writeFileSync(digestPath, `${digest}\n`, { flag: 'wx' })
}

function writeFence(path: string, state: 'migrating' | 'retired', sourceDigest: string): void {
  writeFileSync(path, JSON.stringify({ version: VERSION, state, sourceDigest, pid: process.pid }) + '\n', { flag: 'wx', mode: 0o600 })
}

function replaceFence(path: string, state: 'migrating' | 'retired', sourceDigest: string): void {
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: VERSION, state, sourceDigest, pid: process.pid }) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}

function assertInputsUnchanged(recordsRoot: string, expectedFiles: string[], expectedDigest: string): void {
  const current = readInputs(recordsRoot)
  const filesEqual = current.files.length === expectedFiles.length && current.files.every((file, index) => file === expectedFiles[index])
  const digest = digestInputs(recordsRoot, current.files)
  if (!filesEqual || digest !== expectedDigest) {
    fail(`JSON migration source changed while fenced; refusing cutover (expected ${expectedDigest}, found ${digest})`)
  }
}

// Once the SQLite fence is installed, the JSON tree is no longer a protocol. Keep only
// runtime/worktree metadata in each envelope and remove the old communication artifacts.
// The importer has already copied every source byte to backupRoot, so this is a reversible
// one-time cutover rather than an in-place compatibility mode.
function retireLegacyArtifacts(recordsRoot: string): void {
  if (!existsSync(recordsRoot)) return
  for (const entry of readdirSync(recordsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(recordsRoot, entry.name)
    const recordPath = join(dir, 'session.json')
    if (existsSync(recordPath)) {
      const raw = parseJson(recordPath)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`cannot retire non-object envelope: ${recordPath}`)
      const envelope = { ...(raw as Record<string, unknown>) }
      for (const field of ['status', 'proposal', 'note', 'parent']) delete envelope[field]
      writeFileSync(recordPath, JSON.stringify(envelope, null, 2) + '\n')
    }
    for (const name of ['watchers.json', 'pending.json', 'timeline.ndjson', 'cursors.json']) {
      try { unlinkSync(join(dir, name)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const timelineDir = join(dir, 'timeline')
    try {
      for (const segment of readdirSync(timelineDir)) unlinkSync(join(timelineDir, segment))
      // The directory itself is protocol state; remove it only after every segment is gone.
      rmdirSync(timelineDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    }
  }
}

export function migrateJsonSessionRecords(options: JsonSessionMigrationOptions): JsonSessionMigrationReport {
  if (!isAbsolute(options.databasePath)) fail('databasePath must be absolute')
  if (isAbsolute(options.recordsRoot)) mkdirSync(options.recordsRoot, { recursive: true })
  const backupRoot = options.backupRoot ?? `${options.databasePath}.json-migration-backup`
  const markerPath = `${options.databasePath}.json-migration.json`
  const fencePath = jsonMigrationFencePath(options.recordsRoot)
  if (existsSync(markerPath)) {
    const marker = parseJson(markerPath) as Partial<JsonSessionMigrationReport>
    if (marker.version !== VERSION || typeof marker.sourceDigest !== 'string') fail(`migration marker ${markerPath} is invalid`)
    if (!existsSync(options.databasePath)) fail(`migration marker exists but database is missing: ${options.databasePath}`)
    retireLegacyArtifacts(options.recordsRoot)
    const markerDigest = String(marker.sourceDigest)
    if (existsSync(fencePath)) replaceFence(fencePath, 'retired', markerDigest)
    else writeFence(fencePath, 'retired', markerDigest)
    return {
      version: VERSION,
      sourceDigest: markerDigest,
      records: Number(marker.records) || 0,
      parentEdges: Number(marker.parentEdges) || 0,
      watchEdges: Number(marker.watchEdges) || 0,
      events: Number(marker.events) || 0,
      orphanParents: Array.isArray(marker.orphanParents) ? marker.orphanParents.filter((value): value is string => typeof value === 'string') : [],
      backupRoot,
      markerPath,
      replayed: true,
    }
  }
  const input = readInputs(options.recordsRoot)
  const sourceDigest = digestInputs(options.recordsRoot, input.files)
  if (existsSync(options.databasePath)) {
    fail(`database exists without a migration marker: ${options.databasePath}; refusing to import into an ambiguous live database`)
  }
  if (existsSync(fencePath)) fail(`JSON migration fence already exists: ${fencePath}; refusing a concurrent or incomplete cutover`)
  const orphanParentPolicy = options.orphanParentPolicy ?? 'fail'
  if (orphanParentPolicy !== 'fail' && orphanParentPolicy !== 'tombstone') fail(`unknown orphan parent policy: ${orphanParentPolicy}`)
  if (input.orphanParents.length && orphanParentPolicy === 'fail') {
    fail(`sessions name retired parents ${input.orphanParents.join(', ')}; rerun the one-time migration with orphanParentPolicy=tombstone to preserve those edges as archived addresses`)
  }
  writeFence(fencePath, 'migrating', sourceDigest)
  let databaseInstalled = false
  try {
    backupInputs(options.recordsRoot, input.files, backupRoot, sourceDigest)
    const stagingDatabasePath = `${options.databasePath}.migration-${process.pid}.tmp`
    if (existsSync(stagingDatabasePath)) fail(`migration staging database already exists: ${stagingDatabasePath}`)
    const app = openProjectSessionApplication({ databasePath: stagingDatabasePath, locality: options.locality, now: options.now })
    let parentEdges = 0, watchEdges = 0, events = 0
    try {
    if (orphanParentPolicy === 'tombstone') {
      for (const parent of input.orphanParents) {
        if (!app.readState(parent)) {
          app.createSession({
            sessionId: parent,
            status: 'archived',
            proposal: null,
            note: null,
            updatedAtMs: 0,
            eventId: createHash('sha256').update(`migration\0${sourceDigest}\0orphan-parent\0${parent}`).digest('hex').slice(0, 32),
          })
          events++
        }
      }
    }
    for (const record of input.records) {
      const state = app.readState(record.session_id)
      const parent = record.parent ?? null
      if (!state) {
        const nativeSessionId = typeof record.harness_session_id === 'string' && record.harness_session_id ? record.harness_session_id : null
        app.createSession({
          sessionId: record.session_id,
          status: record.status,
          proposal: typeof record.proposal === 'string' ? record.proposal : null,
          note: typeof record.note === 'string' ? record.note : null,
          parentSessionId: parent,
          updatedAtMs: record.createdAt ?? 0,
          eventId: createHash('sha256').update(`migration\0${sourceDigest}\0${record.session_id}`).digest('hex').slice(0, 32),
          ...(nativeSessionId ? {
            runtime: {
              namespace: 'spex-governed',
              runtimeKind: typeof record.harness === 'string' && record.harness ? record.harness : 'legacy',
              nativeSessionId,
              nativeStartToken: `migration:${sourceDigest}:${record.session_id}`,
            },
          } : {}),
        })
        events++
      } else if (state.status !== record.status || state.parentSessionId !== parent) {
        fail(`existing SQLite state for ${record.session_id} conflicts with JSON source`)
      } else if (app.events.read(record.session_id).length === 0) {
        fail(`existing SQLite state for ${record.session_id} has no auditable event`)
      }
      if (parent) parentEdges++
    }
    // Replay the old append-only conversation before retiring its files. State rows above establish
    // the protocol addresses; these events preserve the history and pending debt that the JSON tree held.
    for (const record of input.records) {
      const legacy = input.artifacts.get(record.session_id)
      if (!legacy) continue
      const timeline = legacy.timeline
      for (const [index, event] of timeline.entries()) {
        const occurredAtMs = typeof event.ts === 'string' && Number.isFinite(Date.parse(event.ts))
          ? Date.parse(event.ts)
          : (record.createdAt ?? 0)
        const eventId = createHash('sha256').update(`migration\0${sourceDigest}\0${record.session_id}\0timeline\0${index}`).digest('hex').slice(0, 32)
        if (event.kind === 'status') {
          app.protocol.withTransaction(tx => app.events.append(tx, {
            eventId,
            type: 'session.state.changed.v1',
            schemaVersion: 1,
            subjectSessionId: record.session_id,
            payload: encodeEventJson({
              eventId,
              sessionId: record.session_id,
              status: event.status ?? record.status,
              proposal: event.proposal ?? null,
              note: event.note ?? null,
              previousProposal: null,
              previousNote: null,
              parentSessionId: record.parent ?? null,
              previousStatus: null,
              previousParentSessionId: null,
              reason: 'json-migration-history',
            }),
            occurredAtMs,
          }))
          events++
        } else if (typeof event.text === 'string' && typeof event.mid === 'string') {
          app.protocol.withTransaction(tx => app.events.append(tx, {
            eventId,
            type: 'session.message.sent.v1',
            schemaVersion: 1,
            subjectSessionId: record.session_id,
            payload: encodeEventJson({
              messageId: event.mid,
              text: event.text,
              from: event.from ?? null,
              ...(event.replyVia === 'note' ? { replyVia: 'note' } : {}),
            }),
            occurredAtMs,
          }))
          events++
        }
      }
      for (const pending of legacy.pending) {
        const message = app.enqueueMessage(record.session_id, {
          kind: 'session.prompt.v1',
          body: Buffer.from(pending.text, 'utf8'),
          senderSessionId: pending.from,
          headers: pending.attributes,
          idempotencyKey: `legacy:${pending.mid}`,
        })
        // A malformed/partial legacy tree can contain debt without a sent line. Keep that debt visible
        // in the canonical history instead of silently turning it into an unaccounted queue row.
        if (!timeline.some(event => event.kind === 'sent' && event.mid === pending.mid)) {
          const eventId = createHash('sha256').update(`migration\0${sourceDigest}\0${record.session_id}\0pending\0${pending.mid}`).digest('hex').slice(0, 32)
          app.protocol.withTransaction(tx => app.events.append(tx, {
            eventId,
            type: 'session.message.sent.v1',
            schemaVersion: 1,
            subjectSessionId: record.session_id,
            payload: encodeEventJson({ messageId: message.messageId, text: pending.text, from: pending.from }),
            occurredAtMs: message.enqueuedAtMs,
          }))
          events++
        }
      }
    }
    for (const record of input.records) {
      const parent = record.parent ?? null
      if (parent && !app.topology.parents(record.session_id, 'parent').some(edge => edge.fromSessionId === parent)) {
        app.protocol.withTransaction(tx => app.topology.attach(tx, parent, record.session_id, 'parent'))
      }
      for (const entry of input.watches.get(record.session_id) ?? []) {
        for (const source of entry.sources) {
          const channel = source === 'parent' ? 'watch:parent' : 'watch:manual'
          if (!app.topology.parents(record.session_id, channel).some(edge => edge.fromSessionId === entry.watcher)) {
            app.attachWatcher(entry.watcher, record.session_id, channel)
          }
          watchEdges++
        }
      }
    }
      assertInputsUnchanged(options.recordsRoot, input.files, sourceDigest)
      app.close()
      renameSync(stagingDatabasePath, options.databasePath)
      databaseInstalled = true
    } catch (error) {
      try { app.close() } catch { /* preserve the import failure */ }
      for (const sidecar of [`${stagingDatabasePath}-journal`, `${stagingDatabasePath}-wal`, `${stagingDatabasePath}-shm`, stagingDatabasePath]) {
        try { if (existsSync(sidecar)) unlinkSync(sidecar) } catch { /* cleanup is best effort; the original error wins */ }
      }
      throw error
    }
    const report: JsonSessionMigrationReport = {
    version: VERSION,
    sourceDigest,
    records: input.records.length,
    parentEdges,
    watchEdges,
    events,
    orphanParents: input.orphanParents,
    backupRoot,
    markerPath,
    replayed: false,
  }
    mkdirSync(dirname(markerPath), { recursive: true })
    writeFileSync(markerPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    retireLegacyArtifacts(options.recordsRoot)
    replaceFence(fencePath, 'retired', sourceDigest)
    return report
  } catch (error) {
    if (!databaseInstalled) {
      try { unlinkSync(fencePath) } catch { /* preserve the import failure */ }
    }
    throw error
  }
}
