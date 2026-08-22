export type SessionEventErrorCode =
  | 'EVENT_TRANSACTION_INVALID'
  | 'EVENT_SESSION_ID_INVALID'
  | 'EVENT_SESSION_UNKNOWN'
  | 'EVENT_ID_INVALID'
  | 'EVENT_ID_EXISTS'
  | 'EVENT_TYPE_INVALID'
  | 'EVENT_SCHEMA_VERSION_INVALID'
  | 'EVENT_PAYLOAD_INVALID'
  | 'EVENT_TIMESTAMP_INVALID'
  | 'EVENT_SEQUENCE_INVALID'
  | 'EVENT_TYPE_UNKNOWN'
  | 'EVENT_JSON_INVALID'
  | 'EVENT_STORAGE'

export class SessionEventError extends Error {
  readonly code: SessionEventErrorCode

  constructor(code: SessionEventErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'SessionEventError'
    this.code = code
  }
}

export function failSessionEvent(code: SessionEventErrorCode, message: string, cause?: unknown): never {
  throw new SessionEventError(code, message, cause)
}
