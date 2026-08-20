import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCHEMA_VERSION = 1
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS protocol_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
  created_at TEXT NOT NULL,
  retired_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  state TEXT NOT NULL CHECK (state IN ('pending', 'dequeued')),
  protocol_version INTEGER NOT NULL,
  sender_session_id TEXT,
  body BLOB NOT NULL,
  headers_json TEXT NOT NULL,
  idempotency_key TEXT,
  immutable_hash TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency
  ON messages(session_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_pending_fifo
  ON messages(session_id, state, sequence);
`
const SCHEMA_CHECKSUM = createHash('sha256').update(SCHEMA_SQL).digest('hex')

export class ProtocolError extends Error {
  constructor(code, message, cause) {
    super(message, { cause })
    this.name = 'ProtocolError'
    this.code = code
  }
}

const fail = (code, message, cause) => { throw new ProtocolError(code, message, cause) }

function canonicalHeaders(headers) {
  if (headers == null) return '{}'
  if (typeof headers !== 'object' || Array.isArray(headers)) fail('INVALID_MESSAGE', 'headers must be an object')
  const keys = Object.keys(headers).sort()
  for (const key of keys) if (typeof headers[key] !== 'string') fail('INVALID_MESSAGE', `header ${key} must be a string`)
  return JSON.stringify(Object.fromEntries(keys.map(key => [key, headers[key]])))
}

function normalizeMessage(sessionId, input) {
  if (!input || typeof input !== 'object') fail('INVALID_MESSAGE', 'message must be an object')
  const messageId = input.messageId
  if (typeof messageId !== 'string' || !messageId) fail('INVALID_MESSAGE', 'messageId is required')
  if (input.targetSessionId !== sessionId) fail('INVALID_MESSAGE', 'targetSessionId must equal enqueue session')
  const protocolVersion = input.protocolVersion ?? 1
  if (!Number.isInteger(protocolVersion) || protocolVersion < 1) fail('INVALID_MESSAGE', 'protocolVersion must be a positive integer')
  const body = input.body instanceof Uint8Array ? Buffer.from(input.body) : typeof input.body === 'string' ? Buffer.from(input.body) : null
  if (!body) fail('INVALID_MESSAGE', 'body must be UTF-8 string or Uint8Array')
  const senderSessionId = input.senderSessionId ?? null
  if (senderSessionId !== null && typeof senderSessionId !== 'string') fail('INVALID_MESSAGE', 'senderSessionId must be a string')
  const idempotencyKey = input.idempotencyKey ?? null
  if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !idempotencyKey)) fail('INVALID_MESSAGE', 'idempotencyKey must be a non-empty string')
  const headersJson = canonicalHeaders(input.headers)
  const immutableHash = createHash('sha256').update(JSON.stringify({ protocolVersion, messageId, targetSessionId: sessionId, senderSessionId, body: body.toString('base64'), headersJson, idempotencyKey })).digest('hex')
  return { protocolVersion, messageId, targetSessionId: sessionId, senderSessionId, body, headersJson, idempotencyKey, immutableHash }
}

function classifySqlite(error) {
  const message = String(error?.message || error)
  if (/busy|locked/i.test(message)) return 'BUSY'
  if (/readonly|read-only/i.test(message)) return 'READONLY'
  if (/malformed|not a database|disk image/i.test(message)) return 'CORRUPT'
  return null
}

function rowToMessage(row) {
  return {
    sequence: Number(row.sequence),
    messageId: row.message_id,
    targetSessionId: row.session_id,
    protocolVersion: row.protocol_version,
    senderSessionId: row.sender_session_id,
    body: Buffer.from(row.body),
    headers: JSON.parse(row.headers_json),
    idempotencyKey: row.idempotency_key,
    state: row.state,
  }
}

export function openProtocol(databasePath, options = {}) {
  if (typeof databasePath !== 'string' || !isAbsolute(databasePath)) fail('INVALID_PATH', 'databasePath must be absolute')
  if (!databasePath || databasePath.endsWith('/')) fail('INVALID_PATH', 'databasePath must name a database file')
  if (!options.readOnly) mkdirSync(dirname(databasePath), { recursive: true })
  let db
  try {
    db = new DatabaseSync(databasePath, { readOnly: options.readOnly === true })
    db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.trunc(options.busyTimeoutMs ?? 1000))}; PRAGMA foreign_keys=ON;`)
    if (!options.readOnly) db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
    const check = db.prepare('PRAGMA quick_check').get()
    if (!check || Object.values(check)[0] !== 'ok') fail('CORRUPT', 'SQLite quick_check failed')
    ensureSchema(db, options.readOnly === true)
  } catch (error) {
    try { db?.close() } catch {}
    if (error instanceof ProtocolError) throw error
    const code = classifySqlite(error)
    fail(code || 'SQLITE', error.message, error)
  }

  const transaction = (fn) => {
    if (options.readOnly) fail('READONLY', 'write transaction on read-only database')
    try {
      db.exec('BEGIN IMMEDIATE')
      const value = fn(db)
      db.exec('COMMIT')
      return value
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      if (error instanceof ProtocolError) throw error
      const code = classifySqlite(error)
      fail(code || 'SQLITE', error.message, error)
    }
  }

  const requireSession = (sessionId) => {
    const row = db.prepare('SELECT state FROM sessions WHERE session_id=?').get(sessionId)
    if (!row) fail('UNKNOWN_SESSION', `unknown session: ${sessionId}`)
    return row.state
  }

  const api = {
    databasePath,
    initialize(sessionId) {
      if (typeof sessionId !== 'string' || !sessionId) fail('INVALID_SESSION', 'sessionId is required')
      return transaction(() => {
        const existing = db.prepare('SELECT state FROM sessions WHERE session_id=?').get(sessionId)
        if (existing?.state === 'retired') fail('RETIRED', `session is retired: ${sessionId}`)
        if (!existing) db.prepare('INSERT INTO sessions(session_id,state,created_at) VALUES(?,?,?)').run(sessionId, 'active', new Date().toISOString())
        return { sessionId, state: 'active' }
      })
    },
    enqueue(sessionId, input) {
      const message = normalizeMessage(sessionId, input)
      return transaction(() => {
        const state = requireSession(sessionId)
        if (state === 'retired') fail('RETIRED', `session is retired: ${sessionId}`)
        if (message.idempotencyKey) {
          const prior = db.prepare('SELECT * FROM messages WHERE session_id=? AND idempotency_key=?').get(sessionId, message.idempotencyKey)
          if (prior) {
            if (prior.immutable_hash !== message.immutableHash) fail('IDEMPOTENCY_CONFLICT', `idempotency key reused with changed bytes: ${message.idempotencyKey}`)
            return rowToMessage(prior)
          }
        }
        try {
          const result = db.prepare(`INSERT INTO messages(message_id,session_id,state,protocol_version,sender_session_id,body,headers_json,idempotency_key,immutable_hash)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(message.messageId, sessionId, 'pending', message.protocolVersion, message.senderSessionId, message.body, message.headersJson, message.idempotencyKey, message.immutableHash)
          return { ...message, sequence: Number(result.lastInsertRowid), state: 'pending', headers: JSON.parse(message.headersJson), targetSessionId: sessionId }
        } catch (error) {
          if (/UNIQUE constraint failed: messages.message_id/.test(String(error.message))) fail('MESSAGE_ID_CONFLICT', `messageId already exists: ${message.messageId}`, error)
          throw error
        }
      })
    },
    dequeue(sessionId) {
      return transaction(() => {
        const state = requireSession(sessionId)
        if (state === 'retired') fail('RETIRED', `session is retired: ${sessionId}`)
        const row = db.prepare("SELECT * FROM messages WHERE session_id=? AND state='pending' ORDER BY sequence LIMIT 1").get(sessionId)
        if (!row) return null
        db.prepare("UPDATE messages SET state='dequeued' WHERE sequence=? AND state='pending'").run(row.sequence)
        return rowToMessage({ ...row, state: 'dequeued' })
      })
    },
    listPending(sessionId) {
      const state = requireSession(sessionId)
      if (state === 'retired') return []
      return db.prepare("SELECT * FROM messages WHERE session_id=? AND state='pending' ORDER BY sequence").all(sessionId).map(rowToMessage)
    },
    readMessages(sessionId, afterSequence = 0) {
      requireSession(sessionId)
      if (!Number.isInteger(afterSequence) || afterSequence < 0) fail('INVALID_CURSOR', 'afterSequence must be a non-negative integer')
      return db.prepare('SELECT * FROM messages WHERE session_id=? AND sequence>? ORDER BY sequence').all(sessionId, afterSequence).map(rowToMessage)
    },
    retire(sessionId) {
      return transaction(() => {
        const state = requireSession(sessionId)
        if (state === 'retired') return { sessionId, state: 'retired' }
        const pending = db.prepare("SELECT 1 FROM messages WHERE session_id=? AND state='pending' LIMIT 1").get(sessionId)
        if (pending) fail('NON_EMPTY_RETIRE', `cannot retire session with pending messages: ${sessionId}`)
        db.prepare("UPDATE sessions SET state='retired', retired_at=? WHERE session_id=? AND state='active'").run(new Date().toISOString(), sessionId)
        return { sessionId, state: 'retired' }
      })
    },
    withTransaction(callback) {
      if (typeof callback !== 'function') fail('INVALID_TRANSACTION', 'callback is required')
      return transaction(() => callback({
        exec(sql, ...params) { return db.prepare(sql).run(...params) },
        enqueue(sessionId, input) {
          const message = normalizeMessage(sessionId, input)
          const state = requireSession(sessionId)
          if (state === 'retired') fail('RETIRED', `session is retired: ${sessionId}`)
          const result = db.prepare(`INSERT INTO messages(message_id,session_id,state,protocol_version,sender_session_id,body,headers_json,idempotency_key,immutable_hash)
            VALUES(?,?,?,?,?,?,?,?,?)`).run(message.messageId, sessionId, 'pending', message.protocolVersion, message.senderSessionId, message.body, message.headersJson, message.idempotencyKey, message.immutableHash)
          return { ...message, sequence: Number(result.lastInsertRowid), state: 'pending', headers: JSON.parse(message.headersJson), targetSessionId: sessionId }
        },
      }))
    },
    close() { db.close() },
  }
  return api
}

function ensureSchema(db, readOnly) {
  const metaExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='protocol_meta'").get()
  if (!metaExists) {
    if (readOnly) fail('READONLY', 'cannot migrate a fresh database in read-only mode')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(SCHEMA_SQL)
      db.prepare('INSERT INTO protocol_meta(key,value) VALUES(?,?), (?,?)').run('schema_version', String(SCHEMA_VERSION), 'schema_checksum', SCHEMA_CHECKSUM)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch {}
      throw error
    }
    return
  }
  const rows = db.prepare('SELECT key,value FROM protocol_meta WHERE key IN (?,?)').all('schema_version', 'schema_checksum')
  const meta = Object.fromEntries(rows.map(row => [row.key, row.value]))
  if (meta.schema_version !== String(SCHEMA_VERSION)) fail('SCHEMA_UNSUPPORTED', `unsupported schema generation: ${meta.schema_version || 'missing'}`)
  if (meta.schema_checksum !== SCHEMA_CHECKSUM) fail('SCHEMA_CHECKSUM', 'schema migration checksum mismatch')
}

export const driver = { name: 'node:sqlite', version: process.versions.node, api: 'DatabaseSync' }
