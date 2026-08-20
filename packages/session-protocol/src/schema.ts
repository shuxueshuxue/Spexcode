import { createHash } from 'node:crypto'

import { fail } from './errors.js'
import type { SessionProtocol, SqlParam } from './index.js'

export interface ComponentMigration {
  readonly version: number
  readonly sql: string
}

interface StatementResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export interface StatementLike {
  get(...params: SqlParam[]): Record<string, unknown> | undefined
  all(...params: SqlParam[]): Record<string, unknown>[]
  run(...params: SqlParam[]): StatementResult
}

export interface DatabaseLike {
  exec(sql: string): void
  prepare(sql: string): StatementLike
  close(): void
}

interface AppliedMigration {
  version: number
  checksum: string
}

interface PreparedMigration extends ComponentMigration {
  checksum: string
}

interface MigrationTarget {
  readonly readOnly: boolean
  apply(component: string, migrations: readonly ComponentMigration[]): number
}

export const MIN_SQLITE_VERSION = '3.38.0'
export const PROTOCOL_COMPONENT = 'session-protocol'

export const PROTOCOL_MIGRATION_SQL = `
CREATE TABLE protocol_sessions (
  session_id     TEXT    NOT NULL PRIMARY KEY,
  created_at_ms  INTEGER NOT NULL,
  retired_at_ms  INTEGER,
  CHECK (length(session_id) BETWEEN 1 AND 256),
  CHECK (session_id NOT GLOB '*[^0-9A-Za-z_-]*'),
  CHECK (session_id NOT GLOB '-*'),
  CHECK (created_at_ms >= 0),
  CHECK (retired_at_ms IS NULL OR retired_at_ms >= 0)
) STRICT;

CREATE TABLE protocol_messages (
  enqueue_seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id         TEXT    NOT NULL UNIQUE,
  target_session_id  TEXT    NOT NULL REFERENCES protocol_sessions(session_id),
  sender_session_id  TEXT,
  protocol_version   INTEGER NOT NULL,
  kind               TEXT    NOT NULL,
  body               BLOB    NOT NULL,
  headers_json       TEXT    NOT NULL,
  idempotency_key    TEXT,
  payload_hash       BLOB    NOT NULL,
  enqueued_at_ms     INTEGER NOT NULL,
  dequeued_at_ms     INTEGER,
  CHECK (message_id GLOB '[0-9a-f]*' AND length(message_id) = 32),
  CHECK (protocol_version >= 1),
  CHECK (length(kind) BETWEEN 1 AND 64),
  CHECK (kind NOT GLOB '*[^0-9A-Za-z._-]*'),
  CHECK (length(body) <= 1048576),
  CHECK (json_valid(headers_json) AND json_type(headers_json) = 'object'),
  CHECK (length(CAST(headers_json AS BLOB)) <= 65536),
  CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 256),
  CHECK (length(payload_hash) = 32),
  CHECK (enqueued_at_ms >= 0),
  CHECK (dequeued_at_ms IS NULL OR dequeued_at_ms >= 0),
  CHECK (sender_session_id IS NULL OR length(sender_session_id) BETWEEN 1 AND 256)
) STRICT;

CREATE UNIQUE INDEX protocol_messages_idempotency
  ON protocol_messages (target_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX protocol_messages_pending_fifo
  ON protocol_messages (target_session_id, enqueue_seq)
  WHERE dequeued_at_ms IS NULL;

CREATE INDEX protocol_messages_history
  ON protocol_messages (target_session_id, enqueue_seq);
`

export const REGISTRY_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  component      TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  checksum       TEXT    NOT NULL,
  applied_at_ms  INTEGER NOT NULL,
  PRIMARY KEY (component, version)
) STRICT;
`

const migrationChecksum = (sql: string): string =>
  createHash('sha256').update(Buffer.from(sql, 'utf8')).digest('hex')

export const PROTOCOL_MIGRATIONS: readonly PreparedMigration[] = [
  { version: 1, sql: PROTOCOL_MIGRATION_SQL, checksum: migrationChecksum(PROTOCOL_MIGRATION_SQL) },
]

const targets = new WeakMap<SessionProtocol, MigrationTarget>()

export function registerMigrationTarget(protocol: SessionProtocol, target: MigrationTarget): void {
  targets.set(protocol, target)
}

function registryExists(database: DatabaseLike): boolean {
  return Boolean(database.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  ).get())
}

function readApplied(database: DatabaseLike, component: string): AppliedMigration[] | null {
  if (!registryExists(database)) return null
  return database.prepare(
    'SELECT version, checksum FROM schema_migrations WHERE component=? ORDER BY version',
  ).all(component).map(row => ({
    version: Number(row.version),
    checksum: String(row.checksum),
  }))
}

function verifyApplied(
  component: string,
  applied: readonly AppliedMigration[],
  migrations: readonly PreparedMigration[],
): number {
  const highest = migrations.length
  if (applied.length > 0 && applied[applied.length - 1].version > highest) {
    fail(
      'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED',
      `${component} carries schema generation ${applied[applied.length - 1].version}; this build understands ${highest}`,
    )
  }
  for (let index = 0; index < applied.length; index++) {
    if (applied[index].version !== index + 1) {
      fail(
        'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED',
        `${component} migration sequence has a gap at version ${index + 1}`,
      )
    }
    if (applied[index].checksum !== migrations[index].checksum) {
      fail(
        'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH',
        `${component} migration ${applied[index].version} was rewritten after it was applied`,
      )
    }
  }
  return applied.length
}

function prepareMigrations(migrations: readonly ComponentMigration[]): PreparedMigration[] {
  if (!Array.isArray(migrations)) {
    fail('PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED', 'migrations must be an array')
  }
  return migrations.map((migration, index) => {
    if (
      !migration
      || typeof migration !== 'object'
      || migration.version !== index + 1
      || typeof migration.sql !== 'string'
    ) {
      fail(
        'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED',
        `migration versions must be contiguous from 1; invalid entry at ${index + 1}`,
      )
    }
    return { ...migration, checksum: migrationChecksum(migration.sql) }
  })
}

function validTimestamp(now: () => number): number {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('PROTOCOL_SQLITE_ERROR', 'now() must return a non-negative safe integer')
  }
  return value
}

function applyPending(
  database: DatabaseLike,
  component: string,
  migrations: readonly PreparedMigration[],
  done: number,
  now: () => number,
): void {
  const insert = database.prepare(
    'INSERT INTO schema_migrations(component,version,checksum,applied_at_ms) VALUES(?,?,?,?)',
  )
  for (const migration of migrations.slice(done)) {
    database.exec(migration.sql)
    insert.run(component, migration.version, migration.checksum, validTimestamp(now))
  }
}

function inImmediateTransaction<T>(database: DatabaseLike, body: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const value = body()
    database.exec('COMMIT')
    return value
  } catch (error) {
    try { database.exec('ROLLBACK') } catch {}
    throw error
  }
}

const protocolObjectsExist = (database: DatabaseLike): boolean => Boolean(database.prepare(
  "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='protocol_sessions'",
).get())

export function migrateProtocol(database: DatabaseLike, readOnly: boolean, now: () => number): number {
  const applied = readApplied(database, PROTOCOL_COMPONENT)
  if (readOnly) {
    if (applied === null || applied.length !== PROTOCOL_MIGRATIONS.length) {
      fail('PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED', 'read-only database is not migrated to this schema generation')
    }
    return verifyApplied(PROTOCOL_COMPONENT, applied, PROTOCOL_MIGRATIONS)
  }

  if (applied !== null && verifyApplied(PROTOCOL_COMPONENT, applied, PROTOCOL_MIGRATIONS) === PROTOCOL_MIGRATIONS.length) {
    return PROTOCOL_MIGRATIONS.length
  }

  return inImmediateTransaction(database, () => {
    database.exec(REGISTRY_SQL)
    const done = verifyApplied(PROTOCOL_COMPONENT, readApplied(database, PROTOCOL_COMPONENT) ?? [], PROTOCOL_MIGRATIONS)
    if (done === 0 && protocolObjectsExist(database)) {
      fail(
        'PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT',
        'protocol tables exist but schema_migrations does not account for them',
      )
    }
    applyPending(database, PROTOCOL_COMPONENT, PROTOCOL_MIGRATIONS, done, now)
    return PROTOCOL_MIGRATIONS.length
  })
}

export function migrateComponent(
  database: DatabaseLike,
  component: string,
  migrations: readonly ComponentMigration[],
  now: () => number,
): number {
  const prepared = prepareMigrations(migrations)
  const applied = readApplied(database, component)
  if (applied !== null && verifyApplied(component, applied, prepared) === prepared.length) {
    return prepared.length
  }

  return inImmediateTransaction(database, () => {
    database.exec(REGISTRY_SQL)
    const done = verifyApplied(component, readApplied(database, component) ?? [], prepared)
    applyPending(database, component, prepared, done, now)
    return prepared.length
  })
}

function invalidComponent(message: string): never {
  fail('PROTOCOL_TRANSACTION_INVALID', message)
}

export function applyComponentMigrations(
  protocol: SessionProtocol,
  component: string,
  migrations: readonly ComponentMigration[],
): number {
  if (typeof component !== 'string' || !/^[0-9A-Za-z._-]{1,64}$/.test(component)) {
    invalidComponent('component must match [0-9A-Za-z._-]{1,64}')
  }
  if (component === PROTOCOL_COMPONENT) {
    invalidComponent('session-protocol migrations are owned by openProtocol')
  }
  const target = targets.get(protocol)
  if (!target) invalidComponent('protocol must be a live handle returned by openProtocol')
  if (target.readOnly) fail('PROTOCOL_DATABASE_READONLY', 'component migrations require a writable handle')
  return target.apply(component, migrations)
}
