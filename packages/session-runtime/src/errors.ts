export type RuntimeBindingErrorCode =
  | 'RUNTIME_BINDING_TRANSACTION_INVALID'
  | 'RUNTIME_BINDING_NAMESPACE_INVALID'
  | 'RUNTIME_BINDING_SESSION_ID_INVALID'
  | 'RUNTIME_BINDING_SESSION_UNKNOWN'
  | 'RUNTIME_BINDING_SESSION_RETIRED'
  | 'RUNTIME_BINDING_IDENTITY_INVALID'
  | 'RUNTIME_BINDING_METADATA_INVALID'
  | 'RUNTIME_BINDING_GENERATION_REQUIRED'
  | 'RUNTIME_BINDING_GENERATION_STALE'
  | 'RUNTIME_BINDING_NOT_FOUND'
  | 'RUNTIME_BINDING_NOT_BOUND'
  | 'RUNTIME_BINDING_STORAGE'

export class RuntimeBindingError extends Error {
  readonly code: RuntimeBindingErrorCode

  constructor(code: RuntimeBindingErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'RuntimeBindingError'
    this.code = code
  }
}

export function failRuntimeBinding(
  code: RuntimeBindingErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new RuntimeBindingError(code, message, cause)
}
