export type SqlParam = null | number | bigint | string | Uint8Array

export interface MessageInput {
  kind: string
  body: Uint8Array
  headers?: Record<string, string>
  senderSessionId?: string | null
  idempotencyKey?: string | null
  protocolVersion?: number
}

export interface Message {
  enqueueSeq: number
  messageId: string
  targetSessionId: string
  senderSessionId: string | null
  protocolVersion: number
  kind: string
  body: Uint8Array
  headers: Record<string, string>
  idempotencyKey: string | null
  payloadHash: string
  enqueuedAtMs: number
  dequeuedAtMs: number | null
}

export interface SessionAddress {
  sessionId: string
  createdAtMs: number
  retiredAtMs: number | null
}

export interface ProtocolTransaction {
  exec(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number }
  query(sql: string, ...params: SqlParam[]): Record<string, unknown>[]
  enqueue(sessionId: string, message: MessageInput): Message
}

export interface SessionProtocol {
  readonly databasePath: string
  readonly readOnly: boolean
  initialize(sessionId: string): SessionAddress
  enqueue(sessionId: string, message: MessageInput): Message
  dequeue(sessionId: string): Message | null
  listPending(sessionId: string): Message[]
  readMessages(sessionId: string, afterSequence?: number): Message[]
  retire(sessionId: string): SessionAddress
  withTransaction<T>(body: (tx: ProtocolTransaction) => T): T
  dataVersion(): number
  close(): void
}

export interface OpenOptions {
  readOnly?: boolean
  busyTimeoutMs?: number
  now?: () => number
}

export const PROTOCOL_VERSION = 1
export { canonicalPreimage, LIMITS, payloadHash } from './canonical.js'
export { ProtocolError } from './errors.js'
export type { ProtocolErrorCode } from './errors.js'
export { openProtocol } from './engine.js'
export { applyComponentMigrations, MIN_SQLITE_VERSION } from './schema.js'
export type { ComponentMigration } from './schema.js'
