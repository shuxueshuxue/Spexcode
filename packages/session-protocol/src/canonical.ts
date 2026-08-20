import { createHash } from 'node:crypto'

interface CanonicalMessage {
  protocolVersion: number
  targetSessionId: string
  senderSessionId?: string | null
  kind: string
  headers?: Record<string, string>
  body: Uint8Array
}

export const LIMITS = {
  sessionId: 256,
  messageKind: 64,
  idempotencyKey: 256,
  headerKey: 64,
  headerValueBytes: 4096,
  headerCount: 64,
  headersJsonBytes: 65536,
  bodyBytes: 1048576,
} as const

export function canonicalPreimage(message: CanonicalMessage): Uint8Array {
  return Buffer.from(message.body)
}

export function payloadHash(message: CanonicalMessage): Uint8Array {
  return createHash('sha256').update(canonicalPreimage(message)).digest()
}
