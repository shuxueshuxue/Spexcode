import { applyComponentMigrations } from '@spexcode/session-protocol'
import type { ProtocolTransaction, SessionProtocol } from '@spexcode/session-protocol'

import { failRuntimeBinding, RuntimeBindingError } from './errors.js'
import { RUNTIME_BINDINGS_MIGRATIONS } from './schema.js'

const NAMESPACE = /^[0-9A-Za-z._:/-]{1,128}$/
const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/
const RUNTIME_KIND = /^[0-9A-Za-z._:-]{1,64}$/
const MAX_METADATA_BYTES = 8192

export interface RuntimeIdentity {
  namespace: string
  runtimeKind: string
  nativeSessionId: string
  nativeStartToken: string
  metadata?: Record<string, unknown>
}

export interface RuntimeBinding {
  namespace: string
  protocolSessionId: string
  runtimeKind: string
  nativeSessionId: string
  nativeStartToken: string
  bindingGeneration: number
  status: 'bound' | 'unbound'
  boundAtMs: number
  unboundAtMs: number | null
  metadata: Record<string, unknown>
}

export interface BindingOptions {
  expectedGeneration?: number
  now?: number
}

export interface SessionRuntimeBindings {
  bind(
    tx: ProtocolTransaction,
    protocolSessionId: string,
    identity: RuntimeIdentity,
    options?: BindingOptions,
  ): RuntimeBinding
  unbind(
    tx: ProtocolTransaction,
    namespace: string,
    protocolSessionId: string,
    options?: BindingOptions,
  ): RuntimeBinding
  resolve(
    namespace: string,
    protocolSessionId: string,
    tx?: ProtocolTransaction,
  ): RuntimeBinding | null
}

interface BindingRow extends Record<string, unknown> {
  namespace: string
  protocol_session_id: string
  runtime_kind: string
  native_session_id: string
  native_start_token: string
  binding_generation: number | bigint
  status: 'bound' | 'unbound'
  bound_at_ms: number | bigint
  unbound_at_ms: number | bigint | null
  metadata_json: string
}

const SELECT_COLUMNS = `namespace, protocol_session_id, runtime_kind, native_session_id,
  native_start_token, binding_generation, status, bound_at_ms, unbound_at_ms, metadata_json`

export function openRuntimeBindings(protocol: SessionProtocol): SessionRuntimeBindings {
  applyComponentMigrations(protocol, 'session-runtime-bindings', RUNTIME_BINDINGS_MIGRATIONS)

  const requireTransaction = (tx: ProtocolTransaction): ProtocolTransaction => {
    if (!tx || typeof tx.exec !== 'function' || typeof tx.query !== 'function') {
      failRuntimeBinding(
        'RUNTIME_BINDING_TRANSACTION_INVALID',
        'a live protocol transaction context is required',
      )
    }
    return tx
  }

  const requireNamespace = (namespace: string): void => {
    if (typeof namespace !== 'string' || !NAMESPACE.test(namespace)) {
      failRuntimeBinding('RUNTIME_BINDING_NAMESPACE_INVALID', 'namespace has an invalid grammar')
    }
  }

  const requireSessionId = (sessionId: string): void => {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      failRuntimeBinding('RUNTIME_BINDING_SESSION_ID_INVALID', 'protocol session id has an invalid grammar')
    }
  }

  const requireIdentity = (identity: RuntimeIdentity): string => {
    if (!identity || typeof identity !== 'object') {
      failRuntimeBinding('RUNTIME_BINDING_IDENTITY_INVALID', 'runtime identity must be an object')
    }
    requireNamespace(identity.namespace)
    if (typeof identity.runtimeKind !== 'string' || !RUNTIME_KIND.test(identity.runtimeKind)) {
      failRuntimeBinding('RUNTIME_BINDING_IDENTITY_INVALID', 'runtime kind has an invalid grammar')
    }
    if (typeof identity.nativeSessionId !== 'string' || identity.nativeSessionId.length < 1 || identity.nativeSessionId.length > 512) {
      failRuntimeBinding('RUNTIME_BINDING_IDENTITY_INVALID', 'native session id must be nonempty and bounded')
    }
    if (typeof identity.nativeStartToken !== 'string' || identity.nativeStartToken.length < 1 || identity.nativeStartToken.length > 512) {
      failRuntimeBinding('RUNTIME_BINDING_IDENTITY_INVALID', 'native start token must be nonempty and bounded')
    }
    const metadata = identity.metadata ?? {}
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      failRuntimeBinding('RUNTIME_BINDING_METADATA_INVALID', 'metadata must be a JSON object')
    }
    let encoded: string
    try {
      encoded = JSON.stringify(metadata)
    } catch (error) {
      failRuntimeBinding('RUNTIME_BINDING_METADATA_INVALID', 'metadata must be JSON serializable', error)
    }
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_METADATA_BYTES) {
      failRuntimeBinding('RUNTIME_BINDING_METADATA_INVALID', 'metadata exceeds the 8192-byte limit')
    }
    try {
      const roundTrip = JSON.parse(encoded)
      if (!roundTrip || typeof roundTrip !== 'object' || Array.isArray(roundTrip)) {
        failRuntimeBinding('RUNTIME_BINDING_METADATA_INVALID', 'metadata must round-trip as an object')
      }
    } catch (error) {
      failRuntimeBinding('RUNTIME_BINDING_METADATA_INVALID', 'metadata must be valid JSON', error)
    }
    return encoded
  }

  const requireNow = (now: number | undefined): number => {
    const value = now ?? Date.now()
    if (!Number.isSafeInteger(value) || value < 0) {
      failRuntimeBinding('RUNTIME_BINDING_IDENTITY_INVALID', 'timestamp must be a non-negative safe integer')
    }
    return value
  }

  const addressState = (tx: ProtocolTransaction, sessionId: string): 'active' | 'retired' => {
    const rows = tx.query(
      'SELECT retired_at_ms FROM protocol_sessions WHERE session_id=?',
      sessionId,
    )
    if (rows.length === 0) failRuntimeBinding('RUNTIME_BINDING_SESSION_UNKNOWN', `unknown protocol session: ${sessionId}`)
    return rows[0].retired_at_ms === null ? 'active' : 'retired'
  }

  const rowToBinding = (row: BindingRow): RuntimeBinding => {
    let metadata: unknown
    try {
      metadata = JSON.parse(row.metadata_json)
    } catch (error) {
      failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'stored metadata is not valid JSON', error)
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'stored metadata is not a JSON object')
    }
    return {
      namespace: String(row.namespace),
      protocolSessionId: String(row.protocol_session_id),
      runtimeKind: String(row.runtime_kind),
      nativeSessionId: String(row.native_session_id),
      nativeStartToken: String(row.native_start_token),
      bindingGeneration: Number(row.binding_generation),
      status: row.status,
      boundAtMs: Number(row.bound_at_ms),
      unboundAtMs: row.unbound_at_ms === null ? null : Number(row.unbound_at_ms),
      metadata: metadata as Record<string, unknown>,
    }
  }

  const read = (tx: ProtocolTransaction, namespace: string, sessionId: string): RuntimeBinding | null => {
    const rows = tx.query(
      `SELECT ${SELECT_COLUMNS} FROM session_runtime_bindings WHERE namespace=? AND protocol_session_id=?`,
      namespace,
      sessionId,
    ) as BindingRow[]
    return rows.length === 0 ? null : rowToBinding(rows[0])
  }

  const checkGeneration = (existing: RuntimeBinding | null, expectedGeneration: number | undefined): void => {
    if (!existing) {
      if (expectedGeneration !== undefined) {
        failRuntimeBinding('RUNTIME_BINDING_GENERATION_STALE', 'expected generation has no binding to match')
      }
      return
    }
    if (expectedGeneration === undefined) {
      failRuntimeBinding('RUNTIME_BINDING_GENERATION_REQUIRED', 'expected generation is required for an existing binding')
    }
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration !== existing.bindingGeneration) {
      failRuntimeBinding('RUNTIME_BINDING_GENERATION_STALE', 'binding generation is stale')
    }
  }

  const bind = (
    txInput: ProtocolTransaction,
    protocolSessionId: string,
    identity: RuntimeIdentity,
    options: BindingOptions = {},
  ): RuntimeBinding => {
    const tx = requireTransaction(txInput)
    requireSessionId(protocolSessionId)
    const metadataJson = requireIdentity(identity)
    if (addressState(tx, protocolSessionId) === 'retired') {
      failRuntimeBinding('RUNTIME_BINDING_SESSION_RETIRED', `protocol session is retired: ${protocolSessionId}`)
    }
    const existing = read(tx, identity.namespace, protocolSessionId)
    checkGeneration(existing, options.expectedGeneration)
    const generation = existing ? existing.bindingGeneration + 1 : 1
    const now = requireNow(options.now)
    try {
      if (existing) {
        tx.exec(
          `UPDATE session_runtime_bindings SET runtime_kind=?, native_session_id=?, native_start_token=?,
             binding_generation=?, status='bound', bound_at_ms=?, unbound_at_ms=NULL, metadata_json=?
           WHERE namespace=? AND protocol_session_id=?`,
          identity.runtimeKind,
          identity.nativeSessionId,
          identity.nativeStartToken,
          generation,
          now,
          metadataJson,
          identity.namespace,
          protocolSessionId,
        )
      } else {
        tx.exec(
          `INSERT INTO session_runtime_bindings
             (namespace, protocol_session_id, runtime_kind, native_session_id, native_start_token,
              binding_generation, status, bound_at_ms, unbound_at_ms, metadata_json)
           VALUES (?,?,?,?,?,?, 'bound', ?, NULL, ?)`,
          identity.namespace,
          protocolSessionId,
          identity.runtimeKind,
          identity.nativeSessionId,
          identity.nativeStartToken,
          generation,
          now,
          metadataJson,
        )
      }
    } catch (error) {
      if (error instanceof RuntimeBindingError) throw error
      failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'failed to persist runtime binding', error)
    }
    const result = read(tx, identity.namespace, protocolSessionId)
    if (!result) failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'binding disappeared after bind')
    return result
  }

  const unbind = (
    txInput: ProtocolTransaction,
    namespace: string,
    protocolSessionId: string,
    options: BindingOptions = {},
  ): RuntimeBinding => {
    const tx = requireTransaction(txInput)
    requireNamespace(namespace)
    requireSessionId(protocolSessionId)
    if (addressState(tx, protocolSessionId) === 'retired') {
      failRuntimeBinding('RUNTIME_BINDING_SESSION_RETIRED', `protocol session is retired: ${protocolSessionId}`)
    }
    const existing = read(tx, namespace, protocolSessionId)
    if (!existing) failRuntimeBinding('RUNTIME_BINDING_NOT_FOUND', 'runtime binding does not exist')
    checkGeneration(existing, options.expectedGeneration)
    if (existing.status !== 'bound') failRuntimeBinding('RUNTIME_BINDING_NOT_BOUND', 'runtime binding is already unbound')
    const now = requireNow(options.now)
    try {
      tx.exec(
        `UPDATE session_runtime_bindings SET status='unbound', binding_generation=?, unbound_at_ms=?
         WHERE namespace=? AND protocol_session_id=? AND binding_generation=?`,
        existing.bindingGeneration + 1,
        now,
        namespace,
        protocolSessionId,
        existing.bindingGeneration,
      )
    } catch (error) {
      if (error instanceof RuntimeBindingError) throw error
      failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'failed to persist runtime unbinding', error)
    }
    const result = read(tx, namespace, protocolSessionId)
    if (!result) failRuntimeBinding('RUNTIME_BINDING_STORAGE', 'binding disappeared after unbind')
    return result
  }

  const resolve = (
    namespace: string,
    protocolSessionId: string,
    txInput?: ProtocolTransaction,
  ): RuntimeBinding | null => {
    requireNamespace(namespace)
    requireSessionId(protocolSessionId)
    if (txInput) return read(requireTransaction(txInput), namespace, protocolSessionId)
    return protocol.withTransaction(tx => read(tx, namespace, protocolSessionId))
  }

  return { bind, unbind, resolve }
}

export { RuntimeBindingError }
export type { RuntimeBindingErrorCode } from './errors.js'
