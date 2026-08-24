import { applyComponentMigrations } from '@spexcode/session-protocol'
import type { ProtocolTransaction, SessionProtocol } from '@spexcode/session-protocol'

import { failSessionEvent, SessionEventError } from './errors.js'
import { SESSION_EVENTS_MIGRATIONS } from './schema.js'

const EVENT_ID = /^[0-9a-f]{32}$/
const EVENT_TYPE = /^[0-9A-Za-z._:-]{1,128}$/
const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/
const MAX_PAYLOAD_BYTES = 1_048_576

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface NewSessionEvent {
  eventId: string
  type: string
  schemaVersion: number
  subjectSessionId: string
  payload: Uint8Array
  occurredAtMs: number
  ignorable?: boolean
}

export interface SessionEvent {
  eventId: string
  eventSeq: number
  type: string
  schemaVersion: number
  subjectSessionId: string
  payload: Uint8Array
  occurredAtMs: number
  ignorable: boolean
}

export interface EventReadOptions {
  afterSequence?: number
  atSequence?: number
}

export type SessionEventReducer<State> = (state: State, event: SessionEvent) => State
export type SessionEventReducers<State> = Readonly<Record<string, SessionEventReducer<State>>>

export interface ReplayOptions<State> extends EventReadOptions {
  initialState: State
  reducers: SessionEventReducers<State>
}

export interface SessionEventStore {
  append(tx: ProtocolTransaction, input: NewSessionEvent): SessionEvent
  hasMessageEvent(tx: ProtocolTransaction, subjectSessionId: string, messageId: string): boolean
  read(subjectSessionId: string, options?: EventReadOptions, tx?: ProtocolTransaction): readonly SessionEvent[]
  replay<State>(subjectSessionId: string, options: ReplayOptions<State>, tx?: ProtocolTransaction): State
}

interface EventRow extends Record<string, unknown> {
  subject_session_id: string
  event_seq: number | bigint
  event_id: string
  event_type: string
  schema_version: number | bigint
  ignorable: number | bigint
  payload: Uint8Array
  occurred_at_ms: number | bigint
}

const SELECT_COLUMNS = `subject_session_id, event_seq, event_id, event_type,
  schema_version, ignorable, payload, occurred_at_ms`

const requireTransaction = (tx: ProtocolTransaction): ProtocolTransaction => {
  if (!tx || typeof tx.exec !== 'function' || typeof tx.query !== 'function') {
    failSessionEvent('EVENT_TRANSACTION_INVALID', 'a live protocol transaction context is required')
  }
  return tx
}

const requireSessionId = (subjectSessionId: string): void => {
  if (typeof subjectSessionId !== 'string' || !SESSION_ID.test(subjectSessionId)) {
    failSessionEvent('EVENT_SESSION_ID_INVALID', 'subject session id has an invalid grammar')
  }
}

const requireSequence = (value: number | undefined, name: string, defaultValue: number): number => {
  const resolved = value ?? defaultValue
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    failSessionEvent('EVENT_SEQUENCE_INVALID', `${name} must be a non-negative safe integer`)
  }
  return resolved
}

const requireEnvelope = (input: NewSessionEvent): Uint8Array => {
  if (!input || typeof input !== 'object') {
    failSessionEvent('EVENT_PAYLOAD_INVALID', 'event input must be an object')
  }
  if (typeof input.eventId !== 'string' || !EVENT_ID.test(input.eventId)) {
    failSessionEvent('EVENT_ID_INVALID', 'event id must be exactly 32 lowercase hexadecimal characters')
  }
  if (typeof input.type !== 'string' || !EVENT_TYPE.test(input.type)) {
    failSessionEvent('EVENT_TYPE_INVALID', 'event type has an invalid grammar')
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    failSessionEvent('EVENT_SCHEMA_VERSION_INVALID', 'schema version must be a positive safe integer')
  }
  requireSessionId(input.subjectSessionId)
  if (!(input.payload instanceof Uint8Array) || input.payload.byteLength > MAX_PAYLOAD_BYTES) {
    failSessionEvent('EVENT_PAYLOAD_INVALID', `payload must be Uint8Array at most ${MAX_PAYLOAD_BYTES} bytes`)
  }
  if (!Number.isSafeInteger(input.occurredAtMs) || input.occurredAtMs < 0) {
    failSessionEvent('EVENT_TIMESTAMP_INVALID', 'occurredAtMs must be a non-negative safe integer')
  }
  if (input.ignorable !== undefined && typeof input.ignorable !== 'boolean') {
    failSessionEvent('EVENT_PAYLOAD_INVALID', 'ignorable must be a boolean when present')
  }
  return new Uint8Array(input.payload)
}

const eventFromRow = (row: EventRow): SessionEvent => Object.freeze({
  eventId: String(row.event_id),
  eventSeq: Number(row.event_seq),
  type: String(row.event_type),
  schemaVersion: Number(row.schema_version),
  subjectSessionId: String(row.subject_session_id),
  payload: new Uint8Array(row.payload),
  occurredAtMs: Number(row.occurred_at_ms),
  ignorable: Number(row.ignorable) === 1,
})

const snapshotJson = (value: unknown, path: string, active: Set<object>): JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      failSessionEvent('EVENT_JSON_INVALID', `${path} contains a non-lossless JSON number`)
    }
    return value
  }
  if (typeof value !== 'object') {
    failSessionEvent('EVENT_JSON_INVALID', `${path} contains a non-JSON value`)
  }
  if (active.has(value)) failSessionEvent('EVENT_JSON_INVALID', `${path} contains a cycle`)
  active.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value)
      if (keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) {
        failSessionEvent('EVENT_JSON_INVALID', `${path} contains non-index array properties`)
      }
      const result: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          failSessionEvent('EVENT_JSON_INVALID', `${path} contains a sparse array`)
        }
        result.push(snapshotJson(value[index], `${path}[${index}]`, active))
      }
      return result
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      failSessionEvent('EVENT_JSON_INVALID', `${path} must contain only plain JSON objects`)
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const symbols = Object.getOwnPropertySymbols(value)
    if (symbols.length > 0) failSessionEvent('EVENT_JSON_INVALID', `${path} contains symbol keys`)
    const result: Record<string, JsonValue> = {}
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !('value' in descriptor)) {
        failSessionEvent('EVENT_JSON_INVALID', `${path}.${key} is not an enumerable data property`)
      }
      result[key] = snapshotJson(descriptor.value, `${path}.${key}`, active)
    }
    return result
  } finally {
    active.delete(value)
  }
}

export function encodeEventJson(value: unknown): Uint8Array {
  const snapshot = snapshotJson(value, '$', new Set())
  return new TextEncoder().encode(JSON.stringify(snapshot))
}

export function decodeEventJson(payload: Uint8Array): JsonValue {
  if (!(payload instanceof Uint8Array)) {
    failSessionEvent('EVENT_JSON_INVALID', 'JSON payload must be Uint8Array')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch (error) {
    failSessionEvent('EVENT_JSON_INVALID', 'JSON payload is not valid UTF-8', error)
  }
  try {
    return snapshotJson(JSON.parse(text), '$', new Set())
  } catch (error) {
    if (error instanceof SessionEventError) throw error
    failSessionEvent('EVENT_JSON_INVALID', 'payload is not valid JSON', error)
  }
}

export function openSessionEvents(protocol: SessionProtocol): SessionEventStore {
  try {
    applyComponentMigrations(protocol, 'session-events', SESSION_EVENTS_MIGRATIONS)
  } catch (error) {
    failSessionEvent('EVENT_STORAGE', 'session event component migration failed', error)
  }

  const requireSubject = (tx: ProtocolTransaction, subjectSessionId: string): void => {
    const rows = tx.query('SELECT 1 AS present FROM protocol_sessions WHERE session_id=?', subjectSessionId)
    if (rows.length === 0) {
      failSessionEvent('EVENT_SESSION_UNKNOWN', `unknown protocol session: ${subjectSessionId}`)
    }
  }

  const append = (txInput: ProtocolTransaction, input: NewSessionEvent): SessionEvent => {
    const tx = requireTransaction(txInput)
    const payload = requireEnvelope(input)
    requireSubject(tx, input.subjectSessionId)
    if (tx.query('SELECT 1 AS present FROM session_events WHERE event_id=?', input.eventId).length > 0) {
      failSessionEvent('EVENT_ID_EXISTS', `event id already exists: ${input.eventId}`)
    }
    const nextRows = tx.query(
      'SELECT COALESCE(MAX(event_seq), 0) + 1 AS next_seq FROM session_events WHERE subject_session_id=?',
      input.subjectSessionId,
    )
    const eventSeq = Number(nextRows[0]?.next_seq)
    if (!Number.isSafeInteger(eventSeq) || eventSeq < 1) {
      failSessionEvent('EVENT_SEQUENCE_INVALID', 'next event sequence is not a positive safe integer')
    }
    try {
      tx.exec(
        `INSERT INTO session_events
          (subject_session_id,event_seq,event_id,event_type,schema_version,ignorable,payload,occurred_at_ms)
         VALUES(?,?,?,?,?,?,?,?)`,
        input.subjectSessionId,
        eventSeq,
        input.eventId,
        input.type,
        input.schemaVersion,
        input.ignorable === true ? 1 : 0,
        payload,
        input.occurredAtMs,
      )
    } catch (error) {
      failSessionEvent('EVENT_STORAGE', 'event insert failed', error)
    }
    return Object.freeze({
      eventId: input.eventId,
      eventSeq,
      type: input.type,
      schemaVersion: input.schemaVersion,
      subjectSessionId: input.subjectSessionId,
      payload: new Uint8Array(payload),
      occurredAtMs: input.occurredAtMs,
      ignorable: input.ignorable === true,
    })
  }

  const readInTransaction = (
    txInput: ProtocolTransaction,
    subjectSessionId: string,
    options: EventReadOptions,
  ): readonly SessionEvent[] => {
    const tx = requireTransaction(txInput)
    requireSessionId(subjectSessionId)
    const address = tx.query('SELECT 1 AS present FROM protocol_sessions WHERE session_id=?', subjectSessionId)
    if (address.length === 0) {
      failSessionEvent('EVENT_SESSION_UNKNOWN', `unknown protocol session: ${subjectSessionId}`)
    }
    const afterSequence = requireSequence(options.afterSequence, 'afterSequence', 0)
    const atSequence = requireSequence(options.atSequence, 'atSequence', Number.MAX_SAFE_INTEGER)
    if (atSequence < afterSequence) {
      failSessionEvent('EVENT_SEQUENCE_INVALID', 'atSequence must not precede afterSequence')
    }
    const rows = tx.query(
      `SELECT ${SELECT_COLUMNS} FROM session_events
       WHERE subject_session_id=? AND event_seq>? AND event_seq<=? ORDER BY event_seq`,
      subjectSessionId,
      afterSequence,
      atSequence,
    ) as EventRow[]
    const events = rows.map(eventFromRow)
    for (let index = 0; index < events.length; index++) {
      const expected = afterSequence + index + 1
      if (events[index].eventSeq !== expected) {
        failSessionEvent(
          'EVENT_SEQUENCE_INVALID',
          `subject ${subjectSessionId} has a sequence gap: expected ${expected}, found ${events[index].eventSeq}`,
        )
      }
    }
    return Object.freeze(events)
  }

  const hasMessageEvent = (
    txInput: ProtocolTransaction,
    subjectSessionId: string,
    messageId: string,
  ): boolean => {
    const tx = requireTransaction(txInput)
    requireSubject(tx, subjectSessionId)
    if (typeof messageId !== 'string' || messageId.length === 0) return false
    // Message events are JSON envelopes. Keep the lookup in the event package so adopters do not scan and
    // decode an entire session history merely to make a retry idempotent. json_valid makes malformed legacy
    // payloads non-matching instead of turning a delivery check into a transaction failure.
    return tx.query(
      `SELECT 1 AS present FROM session_events
       WHERE subject_session_id=? AND event_type='session.message.sent.v1'
         AND json_valid(CAST(payload AS TEXT))
         AND json_extract(CAST(payload AS TEXT), '$.messageId')=? LIMIT 1`,
      subjectSessionId,
      messageId,
    ).length > 0
  }

  const read = (
    subjectSessionId: string,
    options: EventReadOptions = {},
    tx?: ProtocolTransaction,
  ): readonly SessionEvent[] => {
    if (tx !== undefined) return readInTransaction(tx, subjectSessionId, options)
    return protocol.withTransaction(active => readInTransaction(active, subjectSessionId, options))
  }

  const replay = <State>(
    subjectSessionId: string,
    options: ReplayOptions<State>,
    tx?: ProtocolTransaction,
  ): State => {
    if (!options || typeof options !== 'object' || !options.reducers || typeof options.reducers !== 'object') {
      failSessionEvent('EVENT_TYPE_UNKNOWN', 'replay requires a reducer table')
    }
    let state = options.initialState
    for (const event of read(subjectSessionId, options, tx)) {
      const reducer = Object.prototype.hasOwnProperty.call(options.reducers, event.type)
        ? options.reducers[event.type]
        : undefined
      if (typeof reducer !== 'function') {
        if (event.ignorable) continue
        failSessionEvent('EVENT_TYPE_UNKNOWN', `required event type has no reducer: ${event.type}`)
      }
      state = reducer(state, event)
    }
    return state
  }

  return Object.freeze({ append, hasMessageEvent, read, replay })
}

export { SessionEventError } from './errors.js'
export type { SessionEventErrorCode } from './errors.js'
export { SESSION_EVENTS_MIGRATION_SQL, SESSION_EVENTS_MIGRATIONS } from './schema.js'
