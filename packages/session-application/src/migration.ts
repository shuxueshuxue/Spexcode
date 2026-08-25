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

import { openProjectSessionApplication, type LocalityPrecondition, type ProductionSessionApplication } from './production.js'
import { encodeEventJson, type SessionEvent } from '@spexcode/session-events'

const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/
const STATUS = /^[0-9A-Za-z._:-]{1,64}$/
const VERSION = 1

/** Migrated legacy history keeps the live payload shapes under its own ignorable types: a timeline projection
 * shows it beside live events, while state replay (which knows only the live types) skips it as history. */
export const MIGRATED_STATE_EVENT = 'session.state.migrated.v1'
export const MIGRATED_MESSAGE_EVENT = 'session.message.migrated.v1'
const LIVE_STATE_EVENT = 'session.state.changed.v1'
const LIVE_MESSAGE_EVENT = 'session.message.sent.v1'
// A follow cursor is a position in the projected timeline: these four types ordered by occurrence, then sequence.
const PROJECTED_EVENT_TYPES = new Set([LIVE_STATE_EVENT, LIVE_MESSAGE_EVENT, MIGRATED_STATE_EVENT, MIGRATED_MESSAGE_EVENT])

const LEGACY_ENVELOPE = 'session.json'
const RETIRED_ENVELOPE = 'runtime.json'
const LEGACY_ARTIFACT_FILES = ['watchers.json', 'pending.json', 'timeline.ndjson', 'cursors.json'] as const
const LEGACY_TIMELINE_DIR = 'timeline'

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

// One session directory of the legacy tree. `record` is a legacy envelope that still carries lifecycle; `retired`
// is an envelope that carries only runtime metadata — under the retired name, or under the legacy name when a
// post-cutover writer had already stopped putting lifecycle in it. `files` is every legacy file found, which is the
// digest, backup, and retire set for that directory. A directory with no `files` holds no legacy residue.
interface LegacyDir {
  id: string
  envelope: typeof LEGACY_ENVELOPE | typeof RETIRED_ENVELOPE | null
  record: JsonMigrationRecord | null
  retired: Record<string, unknown> | null
  watches: WatchEntry[]
  timeline: LegacyTimelineEvent[]
  pending: LegacyPendingMessage[]
  files: string[]
}

export interface JsonSessionMigrationOptions {
  databasePath: string
  recordsRoot: string
  locality: LocalityPrecondition
  backupRoot?: string
  now?: () => number
  orphanParentPolicy?: 'fail' | 'tombstone'
  /** A caller that already owns the open canonical application lends it for residue import; otherwise the
   * importer opens and closes its own handle. */
  application?: ProductionSessionApplication
}

/** The durable fence shared by the one-time importer and legacy JSON writers. */
export function jsonMigrationFencePath(recordsRoot: string): string {
  return join(recordsRoot, '.json-migration.lock')
}

export interface JsonResidueMigrationReport {
  sourceDigest: string
  records: number
  events: number
  parentEdges: number
  watchEdges: number
  pending: number
  unclaimed: string[]
  backupRoot: string
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
  residue?: JsonResidueMigrationReport
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

function readLegacyDir(recordsRoot: string, id: string): LegacyDir {
  if (!SESSION_ID.test(id)) fail(`ambiguous session directory name: ${id}`)
  const dir = join(recordsRoot, id)
  const files: string[] = []
  let envelope: LegacyDir['envelope'] = null
  let record: JsonMigrationRecord | null = null
  let retired: Record<string, unknown> | null = null
  const recordPath = join(dir, LEGACY_ENVELOPE)
  const retiredPath = join(dir, RETIRED_ENVELOPE)
  if (existsSync(recordPath)) {
    if (existsSync(retiredPath)) fail(`ambiguous session envelope: both ${recordPath} and ${retiredPath} exist`)
    envelope = LEGACY_ENVELOPE
    const raw = parseJson(recordPath)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`corrupt session record: ${recordPath}`)
    const candidate = raw as JsonMigrationRecord
    if (candidate.session_id !== id || typeof candidate.session_id !== 'string' || !SESSION_ID.test(candidate.session_id)) {
      fail(`ambiguous session id in ${recordPath}`)
    }
    if (candidate.createdAt !== undefined && (!Number.isSafeInteger(candidate.createdAt) || candidate.createdAt < 0)) fail(`invalid createdAt in ${recordPath}`)
    if (candidate.status === undefined) {
      // A writer that already deferred lifecycle to the canonical store left only runtime metadata under the old name.
      retired = candidate
    } else {
      if (typeof candidate.status !== 'string' || !STATUS.test(candidate.status)) fail(`invalid status in ${recordPath}`)
      if (candidate.parent !== undefined && candidate.parent !== null && candidate.parent !== '' && (typeof candidate.parent !== 'string' || !SESSION_ID.test(candidate.parent))) {
        fail(`invalid parent in ${recordPath}`)
      }
      // Empty was the legacy root marker; normalize it without changing the source digest.
      record = candidate.parent === '' ? { ...candidate, parent: null } : candidate
    }
    files.push(recordPath)
  } else if (existsSync(retiredPath)) {
    envelope = RETIRED_ENVELOPE
    const raw = parseJson(retiredPath)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`corrupt retired envelope: ${retiredPath}`)
    retired = raw as Record<string, unknown>
  }
  const watches: WatchEntry[] = []
  const watchPath = join(dir, 'watchers.json')
  if (existsSync(watchPath)) {
    const parsed = parseJson(watchPath)
    if (!Array.isArray(parsed)) fail(`watchers file is not an array: ${watchPath}`)
    const seen = new Set<string>()
    for (const [index, value] of (parsed as unknown[]).entries()) {
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
      watches.push({ watcher, createdAt, sources: sources as ('manual' | 'parent')[], ...(row.snapshotPending === undefined ? {} : { snapshotPending: row.snapshotPending }) })
    }
    files.push(watchPath)
  }
  const timelineDir = join(dir, LEGACY_TIMELINE_DIR)
  const timelineFiles = [
    join(dir, 'timeline.ndjson'),
    ...(existsSync(timelineDir) && statSync(timelineDir).isDirectory()
      ? readdirSync(timelineDir).filter(name => /^\d+\.ndjson$/.test(name)).sort().map(name => join(timelineDir, name))
      : []),
  ].filter(existsSync)
  const timeline: LegacyTimelineEvent[] = []
  for (const file of timelineFiles) {
    for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch (error) { fail(`invalid legacy timeline line in ${file}: ${error instanceof Error ? error.message : String(error)}`) }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`invalid legacy timeline event in ${file}`)
      const event = parsed as Record<string, unknown>
      if (event.kind === 'dispatch-settled') continue
      if (event.kind !== 'status' && event.kind !== 'sent') fail(`unknown legacy timeline event kind in ${file}`)
      timeline.push(event as LegacyTimelineEvent)
    }
    files.push(file)
  }
  const pending: LegacyPendingMessage[] = []
  const pendingPath = join(dir, 'pending.json')
  if (existsSync(pendingPath)) {
    const parsed = parseJson(pendingPath)
    if (!Array.isArray(parsed)) fail(`legacy pending file is not an array: ${pendingPath}`)
    for (const [index, value] of (parsed as unknown[]).entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid legacy pending row ${index} in ${pendingPath}`)
      const row = value as Partial<LegacyPendingMessage>
      if (typeof row.mid !== 'string' || typeof row.text !== 'string' || (row.from !== null && typeof row.from !== 'string')) fail(`invalid legacy pending row ${index} in ${pendingPath}`)
      pending.push(row as LegacyPendingMessage)
    }
    files.push(pendingPath)
  }
  // Follow cursors were positions in the retired ndjson projection; nothing in the canonical store maps to them,
  // so they are backed up and retired without import.
  const cursorsPath = join(dir, 'cursors.json')
  if (existsSync(cursorsPath)) files.push(cursorsPath)
  return { id, envelope, record, retired, watches, timeline, pending, files: files.sort() }
}

function readLegacyTree(recordsRoot: string): LegacyDir[] {
  if (!isAbsolute(recordsRoot)) fail('recordsRoot must be an absolute directory')
  if (!existsSync(recordsRoot)) return []
  if (!statSync(recordsRoot).isDirectory()) fail(`recordsRoot is not a directory: ${recordsRoot}`)
  const dirs = readdirSync(recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  return dirs.map(id => readLegacyDir(recordsRoot, id))
}

/** Whether the legacy tree still holds anything the canonical store must absorb before the tree is retired. */
export function legacyResidueExists(recordsRoot: string): boolean {
  if (!existsSync(recordsRoot)) return false
  for (const entry of readdirSync(recordsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(recordsRoot, entry.name)
    if ([LEGACY_ENVELOPE, ...LEGACY_ARTIFACT_FILES, LEGACY_TIMELINE_DIR].some(name => existsSync(join(dir, name)))) return true
  }
  return false
}

function requireParentForest(records: JsonMigrationRecord[]): void {
  // Parent pointers are a single rooted forest. Detect cycles before writing.
  for (const record of records) {
    const chain = new Set<string>()
    let current: string | null | undefined = record.session_id
    while (current) {
      if (chain.has(current)) fail(`parent cycle includes ${current}`)
      chain.add(current)
      current = records.find(candidate => candidate.session_id === current)?.parent
    }
  }
}

function readInputs(recordsRoot: string): { records: JsonMigrationRecord[]; dirs: Map<string, LegacyDir>; files: string[]; orphanParents: string[] } {
  const tree = readLegacyTree(recordsRoot)
  for (const dir of tree) {
    if (dir.envelope === LEGACY_ENVELOPE && !dir.record) fail(`session record ${join(recordsRoot, dir.id, LEGACY_ENVELOPE)} carries no lifecycle; only a marked store may hold a retired envelope`)
  }
  const records = tree.flatMap(dir => dir.record ? [dir.record] : [])
  const byId = new Set(records.map(record => record.session_id))
  const orphanParents = [...new Set(records.flatMap(record => record.parent && !byId.has(record.parent) ? [record.parent] : []))].sort()
  for (const dir of tree) {
    if (!dir.record) continue
    for (const entry of dir.watches) if (!byId.has(entry.watcher)) fail(`session ${dir.id} names missing watcher ${entry.watcher}`)
  }
  requireParentForest(records)
  return {
    records: records.sort((a, b) => a.session_id.localeCompare(b.session_id)),
    dirs: new Map(tree.map(dir => [dir.id, dir])),
    files: tree.flatMap(dir => dir.files).sort(),
    orphanParents,
  }
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

function assertResidueInputsUnchanged(recordsRoot: string, expectedFiles: string[], expectedDigest: string): void {
  const current = readLegacyTree(recordsRoot).flatMap(dir => dir.files).sort()
  const filesEqual = current.length === expectedFiles.length && current.every((file, index) => file === expectedFiles[index])
  const digest = digestInputs(recordsRoot, current)
  if (!filesEqual || digest !== expectedDigest) {
    fail(`JSON migration residue changed while fenced; refusing retire (expected ${expectedDigest}, found ${digest})`)
  }
}

const eventIdFor = (seed: string, ...parts: string[]): string =>
  createHash('sha256').update([seed, ...parts].join('\0')).digest('hex').slice(0, 32)

const projectedOrder = (events: readonly SessionEvent[]): SessionEvent[] =>
  events.filter(event => PROJECTED_EVENT_TYPES.has(event.type))
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.eventSeq - b.eventSeq)

interface HistoryFallback { status: string; parent: string | null; createdAtMs: number }

// One subject's legacy conversation lands in ONE transaction, keyed by its first deterministic event id: a
// re-run after an interrupted import finds that id and skips the whole subject, so no line is ever appended
// twice. Migrated history sorts before the live events already in the store, so every stored follow cursor on
// this subject moves forward by the number of history lines that now precede its position — a consumed event
// never becomes unread again.
function replayTimeline(app: ProductionSessionApplication, subject: string, timeline: LegacyTimelineEvent[], fallback: HistoryFallback, seed: string): number {
  if (timeline.length === 0) return 0
  return app.protocol.withTransaction(tx => {
    if (tx.query('SELECT 1 AS present FROM session_events WHERE event_id=?', eventIdFor(seed, 'timeline', '0')).length > 0) return 0
    const before = projectedOrder(app.events.read(subject, {}, tx))
    const cursors = tx.query('SELECT watcher_session_id AS watcher, event_seq AS position FROM session_follow_cursors WHERE subject_session_id=?', subject) as Array<{ watcher: string; position: number | bigint }>
    const appended: number[] = []
    for (const [index, event] of timeline.entries()) {
      const occurredAtMs = typeof event.ts === 'string' && Number.isFinite(Date.parse(event.ts)) ? Date.parse(event.ts) : fallback.createdAtMs
      const eventId = eventIdFor(seed, 'timeline', String(index))
      if (event.kind === 'status') {
        app.events.append(tx, {
          eventId,
          type: MIGRATED_STATE_EVENT,
          schemaVersion: 1,
          subjectSessionId: subject,
          ignorable: true,
          payload: encodeEventJson({
            eventId,
            sessionId: subject,
            status: event.status ?? fallback.status,
            proposal: event.proposal ?? null,
            note: event.note ?? null,
            previousProposal: null,
            previousNote: null,
            parentSessionId: fallback.parent,
            previousStatus: null,
            previousParentSessionId: null,
            reason: 'json-migration-history',
          }),
          occurredAtMs,
        })
      } else if (typeof event.text === 'string' && typeof event.mid === 'string') {
        app.events.append(tx, {
          eventId,
          type: MIGRATED_MESSAGE_EVENT,
          schemaVersion: 1,
          subjectSessionId: subject,
          ignorable: true,
          payload: encodeEventJson({
            messageId: event.mid,
            text: event.text,
            from: event.from ?? null,
            ...(event.replyVia === 'note' ? { replyVia: 'note' } : {}),
          }),
          occurredAtMs,
        })
      } else continue
      appended.push(occurredAtMs)
    }
    for (const cursor of cursors) {
      const position = Number(cursor.position)
      if (position <= 0 || before.length === 0) continue
      const boundary = before[Math.min(position, before.length) - 1]
      const shift = appended.filter(occurredAtMs => occurredAtMs < boundary.occurredAtMs).length
      if (shift > 0) tx.exec('UPDATE session_follow_cursors SET event_seq=? WHERE watcher_session_id=? AND subject_session_id=?', position + shift, cursor.watcher, subject)
    }
    return appended.length
  })
}

// Legacy debt re-enters the canonical queue under a stable idempotency key, so a repeated import returns the
// same queue row. Debt that never had a sent line gets one now, keyed like the queue row, so it stays visible
// in the history instead of becoming an unaccounted queue entry.
function importPending(app: ProductionSessionApplication, subject: string, pending: LegacyPendingMessage[], timeline: LegacyTimelineEvent[], seed: string): { queued: number; events: number } {
  let events = 0
  for (const debt of pending) {
    const message = app.enqueueMessage(subject, {
      kind: 'session.prompt.v1',
      body: Buffer.from(debt.text, 'utf8'),
      senderSessionId: debt.from,
      headers: debt.attributes,
      idempotencyKey: `legacy:${debt.mid}`,
    })
    if (timeline.some(event => event.kind === 'sent' && event.mid === debt.mid)) continue
    const eventId = eventIdFor(seed, 'pending', debt.mid)
    events += app.protocol.withTransaction(tx => {
      if (app.events.hasMessageEvent(tx, subject, message.messageId)) return 0
      app.events.append(tx, {
        eventId,
        type: LIVE_MESSAGE_EVENT,
        schemaVersion: 1,
        subjectSessionId: subject,
        payload: encodeEventJson({ messageId: message.messageId, text: debt.text, from: debt.from }),
        occurredAtMs: message.enqueuedAtMs,
      })
      return 1
    })
  }
  return { queued: pending.length, events }
}

function attachWatches(app: ProductionSessionApplication, subject: string, entries: WatchEntry[]): { edges: number; attached: number } {
  let edges = 0, attached = 0
  for (const entry of entries) {
    for (const source of entry.sources) {
      const channel = source === 'parent' ? 'watch:parent' : 'watch:manual'
      if (!app.topology.parents(subject, channel).some(edge => edge.fromSessionId === entry.watcher)) {
        app.attachWatcher(entry.watcher, subject, channel)
        attached++
      }
      edges++
    }
  }
  return { edges, attached }
}

function attachParent(app: ProductionSessionApplication, subject: string, parent: string | null): number {
  if (!parent || app.topology.parents(subject, 'parent').some(edge => edge.fromSessionId === parent)) return 0
  app.protocol.withTransaction(tx => app.topology.attach(tx, parent, subject, 'parent'))
  return 1
}

function createFromRecord(app: ProductionSessionApplication, record: JsonMigrationRecord, eventId: string): void {
  const nativeSessionId = typeof record.harness_session_id === 'string' && record.harness_session_id ? record.harness_session_id : null
  app.createSession({
    sessionId: record.session_id,
    status: record.status,
    proposal: typeof record.proposal === 'string' ? record.proposal : null,
    note: typeof record.note === 'string' ? record.note : null,
    parentSessionId: record.parent ?? null,
    updatedAtMs: record.createdAt ?? 0,
    eventId,
    ...(nativeSessionId ? {
      runtime: {
        namespace: 'spex-governed',
        runtimeKind: typeof record.harness === 'string' && record.harness ? record.harness : 'legacy',
        nativeSessionId,
        nativeStartToken: `migration:${eventId}`,
      },
    } : {}),
  })
}

function tombstoneOrphans(app: ProductionSessionApplication, orphanParents: string[], seed: string): number {
  let events = 0
  for (const parent of orphanParents) {
    if (app.readState(parent)) continue
    app.createSession({
      sessionId: parent,
      status: 'archived',
      proposal: null,
      note: null,
      updatedAtMs: 0,
      eventId: eventIdFor(seed, 'orphan-parent', parent),
    })
    events++
  }
  return events
}

function requireOrphanPolicy(policy: string, orphanParents: string[]): void {
  if (policy !== 'fail' && policy !== 'tombstone') fail(`unknown orphan parent policy: ${policy}`)
  if (orphanParents.length && policy === 'fail') {
    fail(`sessions name retired parents ${orphanParents.join(', ')}; rerun the one-time migration with orphanParentPolicy=tombstone to preserve those edges as archived addresses`)
  }
}

// Once the SQLite marker is published, the JSON tree is no longer a protocol. Keep only runtime/worktree
// metadata in each envelope and remove the old communication artifacts. Every file removed here was imported
// and copied to a backup root first, so this is a reversible one-time cutover, not an in-place compatibility mode.
function retireLegacyArtifacts(recordsRoot: string): void {
  if (!existsSync(recordsRoot)) return
  const unlinkIfPresent = (path: string): void => {
    try { unlinkSync(path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  for (const entry of readdirSync(recordsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(recordsRoot, entry.name)
    const legacyPath = join(dir, LEGACY_ENVELOPE)
    const recordPath = join(dir, RETIRED_ENVELOPE)
    if (existsSync(legacyPath)) {
      const raw = parseJson(legacyPath)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`cannot retire non-object envelope: ${legacyPath}`)
      const envelope = { ...(raw as Record<string, unknown>) }
      for (const field of ['status', 'proposal', 'note', 'parent']) delete envelope[field]
      writeFileSync(recordPath, JSON.stringify(envelope, null, 2) + '\n')
      unlinkIfPresent(legacyPath)
    }
    for (const name of LEGACY_ARTIFACT_FILES) unlinkIfPresent(join(dir, name))
    const timelineDir = join(dir, LEGACY_TIMELINE_DIR)
    try {
      for (const segment of readdirSync(timelineDir)) unlinkSync(join(timelineDir, segment))
      // The directory itself is protocol state; remove it only after every segment is gone.
      rmdirSync(timelineDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    }
  }
}

// A marked store can still hold legacy residue: a tree cut over by an importer that did not replay history, or
// files a fenced-out writer left behind. Residue is absorbed by the same deterministic importer before the tree
// is retired. Canonical state stays authoritative for every session that already has a row; only a legacy
// envelope with no row creates one. Directories nothing claims (no envelope, no row) are backed up, reported by
// name, and retired: they are not sessions.
function migrateLegacyResidue(options: JsonSessionMigrationOptions, tree: LegacyDir[], backupRoot: string): JsonResidueMigrationReport {
  const files = tree.flatMap(dir => dir.files).sort()
  const sourceDigest = digestInputs(options.recordsRoot, files)
  const residueBackupRoot = join(backupRoot, 'residue', sourceDigest.slice(0, 12))
  const owned = options.application === undefined
  const app = options.application ?? openProjectSessionApplication({ databasePath: options.databasePath, locality: options.locality, now: options.now })
  try {
    const canonicalIds = new Set(app.protocol.withTransaction(tx => tx.query('SELECT session_id FROM session_application_state')).map(row => String(row.session_id)))
    const records = tree.flatMap(dir => dir.record ? [dir.record] : [])
    const known = new Set([...canonicalIds, ...records.map(record => record.session_id)])
    const orphanParents = [...new Set(records.flatMap(record => record.parent && !known.has(record.parent) ? [record.parent] : []))].sort()
    const orphanParentPolicy = options.orphanParentPolicy ?? 'fail'
    requireOrphanPolicy(orphanParentPolicy, orphanParents)
    for (const dir of tree) {
      for (const entry of dir.watches) if (!known.has(entry.watcher)) fail(`session ${dir.id} names missing watcher ${entry.watcher}`)
      if (dir.retired && !canonicalIds.has(dir.id)) fail(`retired envelope ${join(options.recordsRoot, dir.id, dir.envelope!)} has no canonical application state`)
    }
    requireParentForest(records)
    backupInputs(options.recordsRoot, files, residueBackupRoot, sourceDigest)
    const seedFor = (id: string) => `migration\0residue\0${sourceDigest}\0${id}`
    let created = 0, events = 0, parentEdges = 0, watchEdges = 0, pending = 0
    const unclaimed: string[] = []
    if (orphanParentPolicy === 'tombstone') events += tombstoneOrphans(app, orphanParents, `migration\0residue\0${sourceDigest}`)
    for (const dir of tree) {
      const seed = seedFor(dir.id)
      let state = app.readState(dir.id)
      let createdFromResidue = false
      if (!state && dir.record) {
        createFromRecord(app, dir.record, eventIdFor(seed))
        created++
        events++
        createdFromResidue = true
        state = app.readState(dir.id)
      }
      if (!state) { unclaimed.push(dir.id); continue }
      // The canonical row is authoritative for an existing session; a stale legacy envelope must not rewrite
      // its parent. For a newly created row this is the validated parent copied by createFromRecord.
      parentEdges += createdFromResidue && state.parentSessionId !== null
        ? 1
        : attachParent(app, dir.id, state.parentSessionId)
      const retiredCreatedAt = typeof dir.retired?.createdAt === 'number' ? dir.retired.createdAt : null
      const fallback: HistoryFallback = {
        status: state.status,
        parent: state.parentSessionId,
        createdAtMs: dir.record?.createdAt ?? retiredCreatedAt ?? state.updatedAtMs,
      }
      events += replayTimeline(app, dir.id, dir.timeline, fallback, seed)
      const debt = importPending(app, dir.id, dir.pending, dir.timeline, seed)
      pending += debt.queued
      events += debt.events
      watchEdges += attachWatches(app, dir.id, dir.watches).attached
    }
    assertResidueInputsUnchanged(options.recordsRoot, files, sourceDigest)
    return { sourceDigest, records: created, events, parentEdges, watchEdges, pending, unclaimed, backupRoot: residueBackupRoot }
  } finally {
    if (owned) app.close()
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
    const markerDigest = String(marker.sourceDigest)
    const report: JsonSessionMigrationReport = {
      version: VERSION,
      sourceDigest: markerDigest,
      records: Number(marker.records) || 0,
      parentEdges: Number(marker.parentEdges) || 0,
      watchEdges: Number(marker.watchEdges) || 0,
      events: Number(marker.events) || 0,
      orphanParents: Array.isArray(marker.orphanParents) ? marker.orphanParents.filter((value): value is string => typeof value === 'string') : [],
      backupRoot: options.backupRoot ?? (typeof marker.backupRoot === 'string' && isAbsolute(marker.backupRoot) ? marker.backupRoot : backupRoot),
      markerPath,
      replayed: true,
    }
    const residue = readLegacyTree(options.recordsRoot).filter(dir => dir.files.length > 0)
    if (residue.length > 0) report.residue = migrateLegacyResidue(options, residue, report.backupRoot)
    retireLegacyArtifacts(options.recordsRoot)
    if (existsSync(fencePath)) replaceFence(fencePath, 'retired', markerDigest)
    else writeFence(fencePath, 'retired', markerDigest)
    return report
  }
  const input = readInputs(options.recordsRoot)
  const sourceDigest = digestInputs(options.recordsRoot, input.files)
  if (existsSync(options.databasePath)) {
    fail(`database exists without a migration marker: ${options.databasePath}; refusing to import into an ambiguous live database`)
  }
  if (existsSync(fencePath)) fail(`JSON migration fence already exists: ${fencePath}; refusing a concurrent or incomplete cutover`)
  const orphanParentPolicy = options.orphanParentPolicy ?? 'fail'
  requireOrphanPolicy(orphanParentPolicy, input.orphanParents)
  writeFence(fencePath, 'migrating', sourceDigest)
  let databaseInstalled = false
  try {
    backupInputs(options.recordsRoot, input.files, backupRoot, sourceDigest)
    const stagingDatabasePath = `${options.databasePath}.migration-${process.pid}.tmp`
    if (existsSync(stagingDatabasePath)) fail(`migration staging database already exists: ${stagingDatabasePath}`)
    const app = openProjectSessionApplication({ databasePath: stagingDatabasePath, locality: options.locality, now: options.now })
    let parentEdges = 0, watchEdges = 0, events = 0
    try {
      if (orphanParentPolicy === 'tombstone') events += tombstoneOrphans(app, input.orphanParents, `migration\0${sourceDigest}`)
      for (const record of input.records) {
        const state = app.readState(record.session_id)
        const parent = record.parent ?? null
        if (!state) {
          createFromRecord(app, record, eventIdFor(`migration\0${sourceDigest}\0${record.session_id}`))
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
        const dir = input.dirs.get(record.session_id)!
        const seed = `migration\0${sourceDigest}\0${record.session_id}`
        events += replayTimeline(app, record.session_id, dir.timeline, { status: record.status, parent: record.parent ?? null, createdAtMs: record.createdAt ?? 0 }, seed)
        events += importPending(app, record.session_id, dir.pending, dir.timeline, seed).events
      }
      for (const record of input.records) {
        const parent = record.parent ?? null
        if (parent && !app.topology.parents(record.session_id, 'parent').some(edge => edge.fromSessionId === parent)) {
          app.protocol.withTransaction(tx => app.topology.attach(tx, parent, record.session_id, 'parent'))
        }
        watchEdges += attachWatches(app, record.session_id, input.dirs.get(record.session_id)!.watches).edges
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
