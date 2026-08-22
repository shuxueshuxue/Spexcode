import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { openProjectSessionApplication, type LocalityPrecondition } from './production.js'

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

export interface JsonSessionMigrationOptions {
  databasePath: string
  recordsRoot: string
  locality: LocalityPrecondition
  backupRoot?: string
  now?: () => number
}

export interface JsonSessionMigrationReport {
  version: number
  sourceDigest: string
  records: number
  parentEdges: number
  watchEdges: number
  events: number
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

function readInputs(recordsRoot: string): { records: JsonMigrationRecord[]; watches: Map<string, WatchEntry[]>; files: string[] } {
  if (!isAbsolute(recordsRoot)) fail('recordsRoot must be an absolute directory')
  if (!existsSync(recordsRoot)) return { records: [], watches: new Map(), files: [] }
  if (!statSync(recordsRoot).isDirectory()) fail(`recordsRoot is not a directory: ${recordsRoot}`)
  const dirs = readdirSync(recordsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const records: JsonMigrationRecord[] = []
  const watches = new Map<string, WatchEntry[]>()
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
    if (record.parent !== undefined && record.parent !== null && (typeof record.parent !== 'string' || !SESSION_ID.test(record.parent))) {
      fail(`invalid parent in ${recordPath}`)
    }
    if (record.createdAt !== undefined && (!Number.isSafeInteger(record.createdAt) || record.createdAt < 0)) fail(`invalid createdAt in ${recordPath}`)
    if (ids.has(id)) fail(`duplicate session record: ${id}`)
    ids.add(id)
    records.push(record)
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
  }
  const byId = new Set(records.map(record => record.session_id))
  for (const record of records) {
    if (record.parent && !byId.has(record.parent)) fail(`session ${record.session_id} names missing parent ${record.parent}`)
  }
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
  return { records: records.sort((a, b) => a.session_id.localeCompare(b.session_id)), watches, files: files.sort() }
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

export function migrateJsonSessionRecords(options: JsonSessionMigrationOptions): JsonSessionMigrationReport {
  if (!isAbsolute(options.databasePath)) fail('databasePath must be absolute')
  const input = readInputs(options.recordsRoot)
  const sourceDigest = digestInputs(options.recordsRoot, input.files)
  const backupRoot = options.backupRoot ?? `${options.databasePath}.json-migration-backup`
  const markerPath = `${options.databasePath}.json-migration.json`
  if (existsSync(markerPath)) {
    const marker = parseJson(markerPath) as Partial<JsonSessionMigrationReport>
    if (marker.version !== VERSION || marker.sourceDigest !== sourceDigest) fail(`migration marker ${markerPath} does not match current JSON source`)
    if (!existsSync(options.databasePath)) fail(`migration marker exists but database is missing: ${options.databasePath}`)
    return { version: VERSION, sourceDigest, records: Number(marker.records) || 0, parentEdges: Number(marker.parentEdges) || 0, watchEdges: Number(marker.watchEdges) || 0, events: Number(marker.events) || 0, backupRoot, markerPath, replayed: true }
  }
  backupInputs(options.recordsRoot, input.files, backupRoot, sourceDigest)
  const app = openProjectSessionApplication({ databasePath: options.databasePath, locality: options.locality, now: options.now })
  let parentEdges = 0, watchEdges = 0, events = 0
  try {
    for (const record of input.records) {
      const state = app.readState(record.session_id)
      const parent = record.parent ?? null
      if (!state) {
        app.createSession({ sessionId: record.session_id, status: record.status, parentSessionId: parent, updatedAtMs: record.createdAt ?? 0, eventId: createHash('sha256').update(`migration\0${sourceDigest}\0${record.session_id}`).digest('hex').slice(0, 32) })
        events++
      } else if (state.status !== record.status || state.parentSessionId !== parent) {
        fail(`existing SQLite state for ${record.session_id} conflicts with JSON source`)
      } else if (app.events.read(record.session_id).length === 0) {
        fail(`existing SQLite state for ${record.session_id} has no auditable event`)
      }
      if (parent) parentEdges++
    }
    for (const record of input.records) {
      const parent = record.parent ?? null
      if (parent && !app.topology.parents(record.session_id, 'parent').some(edge => edge.fromSessionId === parent)) {
        app.protocol.withTransaction(tx => app.topology.attach(tx, parent, record.session_id, 'parent'))
      }
      for (const entry of input.watches.get(record.session_id) ?? []) {
        if (!app.topology.subscriptions(record.session_id).some(edge => edge.fromSessionId === entry.watcher && edge.toSessionId === record.session_id && edge.relationType === 'watch')) {
          app.attachWatcher(entry.watcher, record.session_id, 'watch')
        }
        watchEdges++
      }
    }
  } finally { app.close() }
  const report: JsonSessionMigrationReport = { version: VERSION, sourceDigest, records: input.records.length, parentEdges, watchEdges, events, backupRoot, markerPath, replayed: false }
  mkdirSync(dirname(markerPath), { recursive: true })
  writeFileSync(markerPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  return report
}
