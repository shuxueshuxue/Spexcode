const SPEX_GOVERNED_NAMESPACE = 'spex-governed'

export interface GovernedRuntimeIdentity {
  protocolSessionId: string
  harnessId: string
  harnessSessionId: string
  nativeStartToken: string
  metadata?: Record<string, unknown>
}

export interface GovernedRuntimeBindingOptions {
  expectedGeneration?: number
  now?: number
}

export interface GovernedRuntimeBinding {
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

export interface GovernedProtocolTransactionHost<Transaction = unknown> {
  withTransaction<T>(body: (transaction: Transaction) => T): T
}

export interface GovernedRuntimeBindingStore<Transaction = unknown> {
  bind(
    transaction: Transaction,
    protocolSessionId: string,
    identity: {
      namespace: string
      runtimeKind: string
      nativeSessionId: string
      nativeStartToken: string
      metadata?: Record<string, unknown>
    },
    options?: GovernedRuntimeBindingOptions,
  ): GovernedRuntimeBinding
  resolve(
    namespace: string,
    protocolSessionId: string,
    transaction?: Transaction,
  ): GovernedRuntimeBinding | null
  unbind(
    transaction: Transaction,
    namespace: string,
    protocolSessionId: string,
    options?: GovernedRuntimeBindingOptions,
  ): GovernedRuntimeBinding
}

function requireNonempty(value: string, field: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Spex governed runtime binding requires ${field}`)
  }
}

/**
 * Bind an identity whose storage and native start token were already established by Spex composition.
 * Database placement, locality, launch, and legacy record publication deliberately remain outside this seam.
 */
export function bindSpexGovernedRuntime<Transaction>(
  protocol: GovernedProtocolTransactionHost<Transaction>,
  bindings: GovernedRuntimeBindingStore<Transaction>,
  identity: GovernedRuntimeIdentity,
  options: GovernedRuntimeBindingOptions = {},
): GovernedRuntimeBinding {
  requireNonempty(identity.protocolSessionId, 'protocolSessionId')
  requireNonempty(identity.harnessId, 'harnessId')
  requireNonempty(identity.harnessSessionId, 'harnessSessionId')
  requireNonempty(identity.nativeStartToken, 'nativeStartToken')
  if (!protocol || typeof protocol.withTransaction !== 'function') {
    throw new TypeError('Spex governed runtime binding requires an open protocol transaction host')
  }
  if (!bindings || typeof bindings.bind !== 'function') {
    throw new TypeError('Spex governed runtime binding requires an open runtime binding store')
  }

  return protocol.withTransaction(transaction => bindings.bind(transaction, identity.protocolSessionId, {
    namespace: SPEX_GOVERNED_NAMESPACE,
    runtimeKind: identity.harnessId,
    nativeSessionId: identity.harnessSessionId,
    nativeStartToken: identity.nativeStartToken,
    metadata: identity.metadata,
  }, options))
}

export function resolveSpexGovernedRuntime<Transaction>(
  bindings: GovernedRuntimeBindingStore<Transaction>,
  protocolSessionId: string,
  transaction?: Transaction,
): GovernedRuntimeBinding | null {
  requireNonempty(protocolSessionId, 'protocolSessionId')
  return bindings.resolve(SPEX_GOVERNED_NAMESPACE, protocolSessionId, transaction)
}

export function unbindSpexGovernedRuntime<Transaction>(
  protocol: GovernedProtocolTransactionHost<Transaction>,
  bindings: GovernedRuntimeBindingStore<Transaction>,
  protocolSessionId: string,
  options: GovernedRuntimeBindingOptions = {},
): GovernedRuntimeBinding {
  requireNonempty(protocolSessionId, 'protocolSessionId')
  return protocol.withTransaction(transaction => bindings.unbind(
    transaction,
    SPEX_GOVERNED_NAMESPACE,
    protocolSessionId,
    options,
  ))
}
