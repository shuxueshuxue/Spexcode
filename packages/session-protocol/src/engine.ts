import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, sep } from 'node:path'

import { normalizeMessage, requireSessionId } from './canonical.js'
import type { NormalizedMessage } from './canonical.js'
import { classifySqliteError, fail, ProtocolError, rethrowProtocolError } from './errors.js'
import type {
  Message,
  MessageInput,
  OpenOptions,
  ProtocolTransaction,
  SessionAddress,
  SessionProtocol,
  SqlParam,
} from './index.js'
import {
  MIN_SQLITE_VERSION,
  migrateComponent,
  migrateProtocol,
  registerMigrationTarget,
} from './schema.js'
import type { ComponentMigration, DatabaseLike } from './schema.js'

interface DatabaseConstructor {
  new(path: string, options: { readOnly: boolean }): DatabaseLike
}

interface SessionRow extends Record<string, unknown> {
  session_id: string
  created_at_ms: number | bigint
  retired_at_ms: number | bigint | null
}

interface MessageRow extends Record<string, unknown> {
  enqueue_seq: number | bigint
  message_id: string
  target_session_id: string
  sender_session_id: string | null
  protocol_version: number | bigint
  kind: string
  body: Uint8Array
  headers_json: string
  idempotency_key: string | null
  payload_hash: Uint8Array
  enqueued_at_ms: number | bigint
  dequeued_at_ms: number | bigint | null
}

export interface ProtocolInspection {
  pragmas(): { journal_mode: string; foreign_keys: number; synchronous: number; busy_timeout: number }
  counts(): { sessions: number; messages: number }
  queryPlans(): {
    dequeueHead: string
    listPending: string
    readMessages: string
    idempotencyLookup: string
  }
}

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: DatabaseConstructor }
const JOURNAL_MODE = 'delete'

const SELECT_COLUMNS = `enqueue_seq, message_id, target_session_id, sender_session_id, protocol_version,
  kind, body, headers_json, idempotency_key, payload_hash, enqueued_at_ms, dequeued_at_ms`

const SQL = {
  session: 'SELECT session_id, created_at_ms, retired_at_ms FROM protocol_sessions WHERE session_id=?',
  head: `SELECT ${SELECT_COLUMNS} FROM protocol_messages INDEXED BY protocol_messages_pending_fifo
         WHERE target_session_id=? AND dequeued_at_ms IS NULL ORDER BY enqueue_seq LIMIT 1`,
  pending: `SELECT ${SELECT_COLUMNS} FROM protocol_messages INDEXED BY protocol_messages_pending_fifo
            WHERE target_session_id=? AND dequeued_at_ms IS NULL ORDER BY enqueue_seq`,
  history: `SELECT ${SELECT_COLUMNS} FROM protocol_messages INDEXED BY protocol_messages_history
            WHERE target_session_id=? AND enqueue_seq>? ORDER BY enqueue_seq`,
  byKey: `SELECT ${SELECT_COLUMNS} FROM protocol_messages INDEXED BY protocol_messages_idempotency
          WHERE target_session_id=? AND idempotency_key=?`,
} as const

const inspections = new WeakMap<SessionProtocol, ProtocolInspection>()

export function inspectProtocol(protocol: SessionProtocol): ProtocolInspection {
  const inspection = inspections.get(protocol)
  if (!inspection) fail('PROTOCOL_TRANSACTION_INVALID', 'inspection requires a live protocol handle')
  return inspection
}

export function isSupportedSqliteVersion(version: unknown): boolean {
  if (typeof version !== 'string') return false
  const parse = (value: string): number[] => value.split('.').map(Number)
  const [major, minor, patch] = parse(version)
  if (![major, minor, patch].every(Number.isInteger)) return false
  const [minimumMajor, minimumMinor, minimumPatch] = parse(MIN_SQLITE_VERSION)
  if (major !== minimumMajor) return major > minimumMajor
  if (minor !== minimumMinor) return minor > minimumMinor
  return patch >= minimumPatch
}

function validateDatabasePath(databasePath: unknown): asserts databasePath is string {
  if (
    typeof databasePath !== 'string'
    || databasePath.length === 0
    || databasePath.startsWith('file:')
    || !isAbsolute(databasePath)
  ) {
    fail('PROTOCOL_PATH_NOT_ABSOLUTE', 'databasePath must be an absolute filesystem path string')
  }
  if (databasePath.includes('\0')) fail('PROTOCOL_PATH_INVALID', 'databasePath must not contain a NUL byte')
  if (databasePath.endsWith(sep)) fail('PROTOCOL_PATH_INVALID', 'databasePath must name a file, not a directory')
}

function checkParentDirectory(databasePath: string): void {
  const directory = dirname(databasePath)
  let stat
  try {
    stat = statSync(directory)
  } catch (error) {
    fail('PROTOCOL_PATH_PARENT_MISSING', `database parent directory does not exist: ${directory}`, error)
  }
  if (!stat.isDirectory()) {
    fail('PROTOCOL_PATH_PARENT_MISSING', `database parent is not a directory: ${directory}`)
  }
}

function normalizeBusyTimeout(value: unknown): number {
  const timeout = value ?? 5000
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) {
    fail('PROTOCOL_PRAGMA_UNSUPPORTED', 'busyTimeoutMs must be a non-negative finite number')
  }
  return Math.trunc(timeout)
}

function normalizeNow(value: unknown): () => number {
  if (value !== undefined && typeof value !== 'function') {
    fail('PROTOCOL_TRANSACTION_INVALID', 'now must be a synchronous function')
  }
  const now = (value ?? (() => Date.now())) as () => number
  return () => {
    const timestamp = now()
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      fail('PROTOCOL_SQLITE_ERROR', 'now() must return a non-negative safe integer')
    }
    return timestamp
  }
}

function sleepSync(milliseconds: number): void {
  const buffer = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buffer, 0, 0, milliseconds)
}

function retryWhileBusy<T>(budgetMs: number, body: () => T): T {
  const deadline = Date.now() + Math.max(budgetMs, 1)
  for (;;) {
    try {
      return body()
    } catch (error) {
      const busy = error instanceof ProtocolError
        ? error.code === 'PROTOCOL_DATABASE_BUSY'
        : classifySqliteError(error) === 'PROTOCOL_DATABASE_BUSY'
      if (!busy || Date.now() >= deadline) throw error
      sleepSync(20)
    }
  }
}

function toMessage(row: MessageRow): Message {
  return {
    enqueueSeq: Number(row.enqueue_seq),
    messageId: row.message_id,
    targetSessionId: row.target_session_id,
    senderSessionId: row.sender_session_id,
    protocolVersion: Number(row.protocol_version),
    kind: row.kind,
    body: Buffer.from(row.body),
    headers: JSON.parse(row.headers_json) as Record<string, string>,
    idempotencyKey: row.idempotency_key,
    payloadHash: Buffer.from(row.payload_hash).toString('hex'),
    enqueuedAtMs: Number(row.enqueued_at_ms),
    dequeuedAtMs: row.dequeued_at_ms === null ? null : Number(row.dequeued_at_ms),
  }
}

function requireSql(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('PROTOCOL_TRANSACTION_INVALID', 'transaction SQL must be a non-empty string')
  }
  return value
}

function requireSqlParams(params: readonly unknown[]): asserts params is SqlParam[] {
  for (const value of params) {
    if (
      value !== null
      && typeof value !== 'string'
      && typeof value !== 'bigint'
      && !(value instanceof Uint8Array)
      && !(typeof value === 'number' && Number.isFinite(value))
    ) {
      fail('PROTOCOL_TRANSACTION_INVALID', 'transaction parameters must be SqlParam values')
    }
  }
}

function buildHandle(
  database: DatabaseLike,
  config: { databasePath: string; readOnly: boolean; now: () => number },
): SessionProtocol {
  const { readOnly, now } = config
  let transactionActive = false
  let closed = false

  const ensureOpen = (): void => {
    if (closed) fail('PROTOCOL_SQLITE_ERROR', 'protocol handle is closed')
  }

  const rejectReentry = (operation: string): void => {
    if (transactionActive) {
      fail(
        'PROTOCOL_TRANSACTION_INVALID',
        `${operation} cannot be called inside withTransaction; use tx.enqueue for messages and tx.exec or tx.query for SQL`,
      )
    }
  }

  const write = <T>(operation: string, body: () => T): T => {
    ensureOpen()
    rejectReentry(operation)
    if (readOnly) fail('PROTOCOL_DATABASE_READONLY', 'this handle was opened read-only')
    try {
      database.exec('BEGIN IMMEDIATE')
    } catch (error) {
      rethrowProtocolError(error)
    }
    try {
      const value = body()
      database.exec('COMMIT')
      return value
    } catch (error) {
      try { database.exec('ROLLBACK') } catch {}
      rethrowProtocolError(error)
    }
  }

  const read = <T>(body: () => T): T => {
    ensureOpen()
    try {
      return body()
    } catch (error) {
      rethrowProtocolError(error)
    }
  }

  const requireAddress = (sessionId: string, allowRetired = false): SessionRow => {
    const row = database.prepare(SQL.session).get(sessionId) as SessionRow | undefined
    if (!row) fail('PROTOCOL_SESSION_UNKNOWN', `unknown protocol address: ${sessionId}`)
    if (!allowRetired && row.retired_at_ms !== null) {
      fail('PROTOCOL_SESSION_RETIRED', `protocol address is retired: ${sessionId}`)
    }
    return row
  }

  const insertNormalizedMessage = (message: NormalizedMessage): Message => {
    const sessionId = message.targetSessionId
    requireAddress(sessionId)
    if (message.idempotencyKey !== null) {
      const prior = database.prepare(SQL.byKey).get(sessionId, message.idempotencyKey) as MessageRow | undefined
      if (prior) {
        if (Buffer.compare(Buffer.from(prior.payload_hash), Buffer.from(message.hash)) !== 0) {
          fail(
            'PROTOCOL_IDEMPOTENCY_CONFLICT',
            `idempotency key ${message.idempotencyKey} was reused with different message bytes`,
          )
        }
        return toMessage(prior)
      }
    }

    const messageId = randomBytes(16).toString('hex')
    const enqueuedAtMs = now()
    database.prepare(`INSERT INTO protocol_messages
      (message_id, target_session_id, sender_session_id, protocol_version, kind, body,
       headers_json, idempotency_key, payload_hash, enqueued_at_ms, dequeued_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      messageId,
      sessionId,
      message.senderSessionId,
      message.protocolVersion,
      message.kind,
      message.body,
      message.headersJson,
      message.idempotencyKey,
      message.hash,
      enqueuedAtMs,
    )
    const row = database.prepare(`SELECT ${SELECT_COLUMNS} FROM protocol_messages WHERE message_id=?`)
      .get(messageId) as MessageRow | undefined
    if (!row) fail('PROTOCOL_SQLITE_ERROR', 'inserted message could not be read back')
    return toMessage(row)
  }

  const insertMessage = (sessionId: string, input: MessageInput): Message =>
    insertNormalizedMessage(normalizeMessage(sessionId, input))

  const transaction: ProtocolTransaction = {
    exec(sql, ...params) {
      requireSql(sql)
      requireSqlParams(params)
      try {
        const result = database.prepare(sql).run(...params)
        return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
      } catch (error) {
        rethrowProtocolError(error)
      }
    },
    query(sql, ...params) {
      requireSql(sql)
      requireSqlParams(params)
      try {
        return database.prepare(sql).all(...params)
      } catch (error) {
        rethrowProtocolError(error)
      }
    },
    enqueue(sessionId, message) {
      requireSessionId(sessionId)
      return insertMessage(sessionId, message)
    },
  }

  const handle: SessionProtocol = {
    databasePath: config.databasePath,
    readOnly,

    initialize(sessionId) {
      rejectReentry('protocol.initialize')
      requireSessionId(sessionId)
      return write('protocol.initialize', () => {
        const existing = database.prepare(SQL.session).get(sessionId) as SessionRow | undefined
        if (existing) {
          if (existing.retired_at_ms !== null) {
            fail('PROTOCOL_SESSION_RETIRED', `protocol address is retired and cannot be resurrected: ${sessionId}`)
          }
          return { sessionId, createdAtMs: Number(existing.created_at_ms), retiredAtMs: null }
        }
        const createdAtMs = now()
        database.prepare('INSERT INTO protocol_sessions(session_id, created_at_ms, retired_at_ms) VALUES(?,?,NULL)')
          .run(sessionId, createdAtMs)
        return { sessionId, createdAtMs, retiredAtMs: null }
      })
    },

    enqueue(sessionId, input) {
      rejectReentry('protocol.enqueue')
      requireSessionId(sessionId)
      const normalized = normalizeMessage(sessionId, input)
      return write('protocol.enqueue', () => insertNormalizedMessage(normalized))
    },

    dequeue(sessionId) {
      rejectReentry('protocol.dequeue')
      requireSessionId(sessionId)
      return write('protocol.dequeue', () => {
        requireAddress(sessionId)
        const row = database.prepare(SQL.head).get(sessionId) as MessageRow | undefined
        if (!row) return null
        const dequeuedAtMs = now()
        const result = database.prepare(
          'UPDATE protocol_messages SET dequeued_at_ms=? WHERE enqueue_seq=? AND dequeued_at_ms IS NULL',
        ).run(dequeuedAtMs, row.enqueue_seq)
        if (Number(result.changes) !== 1) {
          fail('PROTOCOL_SQLITE_ERROR', 'FIFO head changed inside a write transaction')
        }
        return toMessage({ ...row, dequeued_at_ms: dequeuedAtMs })
      })
    },

    listPending(sessionId) {
      requireSessionId(sessionId)
      return read(() => {
        requireAddress(sessionId, true)
        return database.prepare(SQL.pending).all(sessionId).map(row => toMessage(row as MessageRow))
      })
    },

    readMessages(sessionId, afterSequence = 0) {
      requireSessionId(sessionId)
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        fail('PROTOCOL_CURSOR_INVALID', 'afterSequence must be a non-negative safe integer')
      }
      return read(() => {
        requireAddress(sessionId, true)
        return database.prepare(SQL.history).all(sessionId, afterSequence).map(row => toMessage(row as MessageRow))
      })
    },

    retire(sessionId) {
      rejectReentry('protocol.retire')
      requireSessionId(sessionId)
      return write('protocol.retire', () => {
        const row = requireAddress(sessionId, true)
        if (row.retired_at_ms !== null) {
          return {
            sessionId,
            createdAtMs: Number(row.created_at_ms),
            retiredAtMs: Number(row.retired_at_ms),
          }
        }
        const pending = database.prepare(
          `SELECT 1 AS present FROM protocol_messages INDEXED BY protocol_messages_pending_fifo
           WHERE target_session_id=? AND dequeued_at_ms IS NULL LIMIT 1`,
        ).get(sessionId)
        if (pending) {
          fail('PROTOCOL_RETIRE_NON_EMPTY', `cannot retire an address with pending messages: ${sessionId}`)
        }
        const retiredAtMs = now()
        database.prepare('UPDATE protocol_sessions SET retired_at_ms=? WHERE session_id=? AND retired_at_ms IS NULL')
          .run(retiredAtMs, sessionId)
        return { sessionId, createdAtMs: Number(row.created_at_ms), retiredAtMs }
      })
    },

    withTransaction<T>(body: (tx: ProtocolTransaction) => T): T {
      rejectReentry('protocol.withTransaction')
      ensureOpen()
      if (typeof body !== 'function') {
        fail('PROTOCOL_TRANSACTION_INVALID', 'a transaction body is required')
      }
      if (body.constructor?.name === 'AsyncFunction') {
        fail('PROTOCOL_TRANSACTION_INVALID', 'a transaction body must be synchronous; use tx.enqueue inside it')
      }
      if (readOnly) fail('PROTOCOL_DATABASE_READONLY', 'this handle was opened read-only')
      try {
        database.exec('BEGIN IMMEDIATE')
      } catch (error) {
        rethrowProtocolError(error)
      }
      transactionActive = true
      let value: T
      try {
        value = body(transaction)
        if (value && typeof (value as { then?: unknown }).then === 'function') {
          fail('PROTOCOL_TRANSACTION_INVALID', 'a transaction body must not return a promise; use tx.enqueue')
        }
      } catch (error) {
        transactionActive = false
        try { database.exec('ROLLBACK') } catch {}
        throw error
      }
      transactionActive = false
      try {
        database.exec('COMMIT')
        return value
      } catch (error) {
        try { database.exec('ROLLBACK') } catch {}
        rethrowProtocolError(error)
      }
    },

    dataVersion() {
      return read(() => Number(database.prepare('PRAGMA data_version').get()?.data_version))
    },

    close() {
      rejectReentry('protocol.close')
      if (closed) return
      database.close()
      closed = true
    },
  }

  const inspection: ProtocolInspection = {
    pragmas: () => ({
      journal_mode: String(database.prepare('PRAGMA journal_mode').get()?.journal_mode),
      foreign_keys: Number(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys),
      synchronous: Number(database.prepare('PRAGMA synchronous').get()?.synchronous),
      busy_timeout: Number(database.prepare('PRAGMA busy_timeout').get()?.timeout),
    }),
    counts: () => ({
      sessions: Number(database.prepare('SELECT count(*) AS count FROM protocol_sessions').get()?.count),
      messages: Number(database.prepare('SELECT count(*) AS count FROM protocol_messages').get()?.count),
    }),
    queryPlans: () => {
      const plan = (sql: string, ...params: SqlParam[]): string => database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map(row => String(row.detail))
        .join(' | ')
      return {
        dequeueHead: plan(SQL.head, 's'),
        listPending: plan(SQL.pending, 's'),
        readMessages: plan(SQL.history, 's', 0),
        idempotencyLookup: plan(SQL.byKey, 's', 'k'),
      }
    },
  }
  inspections.set(handle, inspection)
  registerMigrationTarget(handle, {
    readOnly,
    apply(component: string, migrations: readonly ComponentMigration[]): number {
      ensureOpen()
      rejectReentry('applyComponentMigrations')
      try {
        return migrateComponent(database, component, migrations, now)
      } catch (error) {
        rethrowProtocolError(error)
      }
    },
  })
  return handle
}

export function openProtocol(databasePath: string, options: OpenOptions = {}): SessionProtocol {
  validateDatabasePath(databasePath)
  checkParentDirectory(databasePath)
  const readOnly = options.readOnly === true
  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs)
  const now = normalizeNow(options.now)

  let database: DatabaseLike
  try {
    database = new DatabaseSync(databasePath, { readOnly })
  } catch (error) {
    rethrowProtocolError(error)
  }

  try {
    database.exec(`PRAGMA busy_timeout=${busyTimeoutMs}`)
    if (Number(database.prepare('PRAGMA busy_timeout').get()?.timeout) !== busyTimeoutMs) {
      fail('PROTOCOL_PRAGMA_UNSUPPORTED', 'busy_timeout did not read back the requested value')
    }

    const version = database.prepare('SELECT sqlite_version() AS version').get()?.version
    if (!isSupportedSqliteVersion(version)) {
      fail(
        'PROTOCOL_SQLITE_VERSION_UNSUPPORTED',
        `SQLite ${String(version)} is below ${MIN_SQLITE_VERSION}`,
      )
    }

    database.exec('PRAGMA foreign_keys=ON')
    if (Number(database.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 1) {
      fail('PROTOCOL_PRAGMA_UNSUPPORTED', 'foreign_keys could not be enabled')
    }

    const mode = String(database.prepare('PRAGMA journal_mode').get()?.journal_mode)
    if (mode !== JOURNAL_MODE) {
      fail(
        'PROTOCOL_JOURNAL_MODE_UNSUPPORTED',
        `journal_mode is ${mode}, not ${JOURNAL_MODE}; this version does not convert a database`,
      )
    }

    retryWhileBusy(busyTimeoutMs, () => {
      if (!readOnly) {
        database.exec('PRAGMA synchronous=FULL')
        if (Number(database.prepare('PRAGMA synchronous').get()?.synchronous) !== 2) {
          fail('PROTOCOL_PRAGMA_UNSUPPORTED', 'synchronous could not be set to FULL')
        }
      }
      migrateProtocol(database, readOnly, now)
    })
  } catch (error) {
    try { database.close() } catch {}
    rethrowProtocolError(error)
  }

  return buildHandle(database, { databasePath, readOnly, now })
}
