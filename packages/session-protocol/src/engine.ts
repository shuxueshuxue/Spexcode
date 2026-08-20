import type { Message, MessageInput, OpenOptions, SessionAddress, SessionProtocol } from './index.js'

const unavailable = (): never => {
  throw new Error('minimal implementation')
}

export function openProtocol(databasePath: string, options: OpenOptions = {}): SessionProtocol {
  return {
    databasePath,
    readOnly: options.readOnly === true,
    initialize(_sessionId: string): SessionAddress { return unavailable() },
    enqueue(_sessionId: string, _message: MessageInput): Message { return unavailable() },
    dequeue(_sessionId: string): Message | null { return unavailable() },
    listPending(_sessionId: string): Message[] { return unavailable() },
    readMessages(_sessionId: string, _afterSequence = 0): Message[] { return unavailable() },
    retire(_sessionId: string): SessionAddress { return unavailable() },
    withTransaction<T>(_body: (tx: never) => T): T { return unavailable() },
    dataVersion(): number { return 0 },
    close(): void {},
  }
}
