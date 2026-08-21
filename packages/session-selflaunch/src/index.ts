export { LocalityError, requireLocalDatabasePath } from './locality.js'
export type { LocalityRefusalCode } from './locality.js'
export { resolveDatabasePath } from './path.js'
export type { ResolveDatabasePathOptions, SelfLaunchEnvironment } from './path.js'

import type { ProtocolTransaction } from '@spexcode/session-protocol'
import {
  openRuntimeBindings,
  type BindingOptions,
  type RuntimeBinding,
} from '@spexcode/session-runtime'

/**
 * Native identity supplied by the harness adapter that owns this self-launch.
 * The CLI session id is deliberately not accepted as a native identity.
 */
export interface SelfLaunchRuntimeIdentity {
  nativeSessionId: string
  nativeStartToken: string
  metadata?: Record<string, unknown>
}

const SELF_LAUNCH_NAMESPACE = 'self-launch'

export interface SelfLaunchProtocol {
  withTransaction<T>(body: (tx: ProtocolTransaction) => T): T
}

export interface SelfLaunchBindingOptions extends BindingOptions {
  runtimeKind?: string
}

/**
 * Attach a caller-owned native harness identity to an existing protocol address.
 * This is the only self-launch/runtime seam; it does not launch, probe, or stop a harness.
 */
export function bindSelfLaunchRuntime(
  protocol: SelfLaunchProtocol,
  protocolSessionId: string,
  identity: SelfLaunchRuntimeIdentity,
  options: SelfLaunchBindingOptions = {},
): RuntimeBinding {
  const bindings = openRuntimeBindings(protocol as Parameters<typeof openRuntimeBindings>[0])
  return protocol.withTransaction(tx => bindings.bind(tx, protocolSessionId, {
    namespace: SELF_LAUNCH_NAMESPACE,
    runtimeKind: options.runtimeKind ?? 'self-launch',
    nativeSessionId: identity.nativeSessionId,
    nativeStartToken: identity.nativeStartToken,
    metadata: identity.metadata,
  }, options))
}

export function resolveSelfLaunchRuntime(
  protocol: SelfLaunchProtocol,
  protocolSessionId: string,
): RuntimeBinding | null {
  return openRuntimeBindings(protocol as Parameters<typeof openRuntimeBindings>[0]).resolve(SELF_LAUNCH_NAMESPACE, protocolSessionId)
}

export function unbindSelfLaunchRuntime(
  protocol: SelfLaunchProtocol,
  protocolSessionId: string,
  options: BindingOptions = {},
): RuntimeBinding {
  const bindings = openRuntimeBindings(protocol as Parameters<typeof openRuntimeBindings>[0])
  return protocol.withTransaction(tx => bindings.unbind(tx, SELF_LAUNCH_NAMESPACE, protocolSessionId, options))
}
