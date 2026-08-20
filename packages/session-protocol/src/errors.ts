export type ProtocolErrorCode =
  | 'PROTOCOL_PATH_NOT_ABSOLUTE'
  | 'PROTOCOL_PATH_INVALID'
  | 'PROTOCOL_PATH_PARENT_MISSING'
  | 'PROTOCOL_SQLITE_VERSION_UNSUPPORTED'
  | 'PROTOCOL_JOURNAL_MODE_UNSUPPORTED'
  | 'PROTOCOL_PRAGMA_UNSUPPORTED'
  | 'PROTOCOL_SCHEMA_CHECKSUM_MISMATCH'
  | 'PROTOCOL_SCHEMA_GENERATION_UNSUPPORTED'
  | 'PROTOCOL_SCHEMA_REGISTRY_INCONSISTENT'
  | 'PROTOCOL_SESSION_ID_INVALID'
  | 'PROTOCOL_SESSION_UNKNOWN'
  | 'PROTOCOL_SESSION_RETIRED'
  | 'PROTOCOL_RETIRE_NON_EMPTY'
  | 'PROTOCOL_IDEMPOTENCY_CONFLICT'
  | 'PROTOCOL_MESSAGE_INVALID'
  | 'PROTOCOL_CURSOR_INVALID'
  | 'PROTOCOL_TRANSACTION_INVALID'
  | 'PROTOCOL_DATABASE_BUSY'
  | 'PROTOCOL_DATABASE_READONLY'
  | 'PROTOCOL_DATABASE_UNAVAILABLE'
  | 'PROTOCOL_DATABASE_CORRUPT'
  | 'PROTOCOL_SQLITE_ERROR'

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode

  constructor(code: ProtocolErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ProtocolError'
    this.code = code
  }
}

export function fail(code: ProtocolErrorCode, message: string, cause?: unknown): never {
  throw new ProtocolError(code, message, cause)
}

export function classifySqliteError(error: unknown): ProtocolErrorCode | null {
  const value = error as { code?: unknown; message?: unknown }
  const code = String(value?.code ?? '')
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return 'PROTOCOL_DATABASE_BUSY'
  if (code === 'SQLITE_READONLY') return 'PROTOCOL_DATABASE_READONLY'
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') return 'PROTOCOL_DATABASE_CORRUPT'
  if (code === 'SQLITE_CANTOPEN') return 'PROTOCOL_DATABASE_UNAVAILABLE'

  const text = String(value?.message ?? error)
  if (/database is locked|database table is locked|SQLITE_BUSY/i.test(text)) return 'PROTOCOL_DATABASE_BUSY'
  if (/readonly|read-only|attempt to write/i.test(text)) return 'PROTOCOL_DATABASE_READONLY'
  if (/malformed|not a database|disk image|corrupt/i.test(text)) return 'PROTOCOL_DATABASE_CORRUPT'
  if (/unable to open database/i.test(text)) return 'PROTOCOL_DATABASE_UNAVAILABLE'
  return null
}

export function rethrowProtocolError(error: unknown): never {
  if (error instanceof ProtocolError) throw error
  const message = String((error as { message?: unknown })?.message ?? error)
  fail(classifySqliteError(error) ?? 'PROTOCOL_SQLITE_ERROR', message, error)
}
