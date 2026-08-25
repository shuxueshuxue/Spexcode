import type {
  Message,
  MessageInput,
  ProtocolTransaction,
  SessionProtocol,
} from '@spexcode/session-protocol'
import type { SessionTopology, TopologyEdge } from '@spexcode/session-topology'

export interface NotificationResult {
  edge: TopologyEdge | null
  recipients: string[]
  messages: Message[]
}

export interface SessionApplication {
  notifyRecipients(subjectSessionId: string, message: MessageInput): NotificationResult
  attachAndNotify(
    fromSessionId: string,
    subjectSessionId: string,
    relationType: string,
    message: MessageInput,
  ): NotificationResult
}

function enqueueForRecipients(
  tx: ProtocolTransaction,
  topology: SessionTopology,
  subjectSessionId: string,
  message: MessageInput,
): NotificationResult {
  const recipients = topology.recipients(subjectSessionId, tx)
  const messages = recipients.map(recipient => tx.enqueue(recipient, {
    ...message,
    senderSessionId: message.senderSessionId === undefined
      ? subjectSessionId
      : message.senderSessionId,
  }))
  return { edge: null, recipients, messages }
}

export function openSessionApplication(
  protocol: SessionProtocol,
  topology: SessionTopology,
): SessionApplication {
  if (!protocol || typeof protocol.withTransaction !== 'function') {
    throw new TypeError('session application requires a live protocol handle')
  }
  if (!topology || typeof topology.recipients !== 'function' || typeof topology.attach !== 'function') {
    throw new TypeError('session application requires a live topology handle')
  }

  const run = (
    subjectSessionId: string,
    message: MessageInput,
    edge: TopologyEdge | null,
    tx: ProtocolTransaction,
  ): NotificationResult => {
    const result = enqueueForRecipients(tx, topology, subjectSessionId, message)
    return { ...result, edge }
  }

  return {
    notifyRecipients(subjectSessionId, message) {
      return protocol.withTransaction(tx => run(subjectSessionId, message, null, tx))
    },
    attachAndNotify(fromSessionId, subjectSessionId, relationType, message) {
      return protocol.withTransaction(tx => {
        const edge = topology.attach(tx, fromSessionId, subjectSessionId, relationType)
        return run(subjectSessionId, message, edge, tx)
      })
    },
  }
}

export { openProjectSessionApplication } from './production.js'
export { jsonMigrationFencePath, legacyResidueExists, migrateJsonSessionRecords, MIGRATED_MESSAGE_EVENT, MIGRATED_STATE_EVENT } from './migration.js'
export type {
  CommittedSessionChange,
  ConversationMessageInput,
  CreateSessionInput,
  LocalityPrecondition,
  NativeRuntimeIdentity,
  ProductionSessionApplication,
  ProjectSessionApplicationOptions,
  SessionState,
  SessionStateChange,
  TransitionSessionInput,
} from './production.js'
export type { SessionEvent } from '@spexcode/session-events'
export type {
  JsonMigrationRecord,
  JsonResidueMigrationReport,
  JsonSessionMigrationOptions,
  JsonSessionMigrationReport,
} from './migration.js'
