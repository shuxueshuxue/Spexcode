import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'

import {
  applyComponentMigrations,
  openProtocol,
  type Message,
  type MessageInput,
  type ProtocolTransaction,
  type SessionProtocol,
} from '@spexcode/session-protocol'
import {
  encodeEventJson,
  openSessionEvents,
  type SessionEvent,
  type SessionEventStore,
} from '@spexcode/session-events'
import {
  openRuntimeBindings,
  type RuntimeBinding,
  type RuntimeIdentity,
  type SessionRuntimeBindings,
} from '@spexcode/session-runtime'
import { openTopology, type SessionTopology, type TopologyEdge } from '@spexcode/session-topology'

import { SESSION_APPLICATION_MIGRATIONS } from './schema.js'

const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/
const STATUS = /^[0-9A-Za-z._:-]{1,64}$/
const STATE_EVENT = 'session.state.changed.v1'
const PARENT_RELATION = 'parent'
const WATCH_RELATION = 'watch'
const compositions = new Map<string, ProductionSessionApplication>()

export interface LocalityPrecondition {
  (databasePath: string): void
}

export interface SessionState {
  sessionId: string
  status: string
  proposal: string | null
  note: string | null
  parentSessionId: string | null
  updatedAtMs: number
}

export interface SessionStateChange {
  sessionId: string
  status: string
  proposal: string | null
  note: string | null
  previousProposal: string | null
  previousNote: string | null
  parentSessionId: string | null
  previousStatus: string | null
  previousParentSessionId: string | null
  reason: string | null
}

export interface NativeRuntimeIdentity {
  namespace: string
  runtimeKind: string
  nativeSessionId: string
  nativeStartToken: string
  metadata?: Record<string, unknown>
}

export interface ProjectSessionApplicationOptions {
  databasePath: string
  locality: LocalityPrecondition
  now?: () => number
  onCommitted?: (result: CommittedSessionChange) => void
}

export interface CreateSessionInput {
  sessionId: string
  status?: string
  parentSessionId?: string | null
  runtime?: NativeRuntimeIdentity
  eventId?: string
  updatedAtMs?: number
  proposal?: string | null
  note?: string | null
}

export interface TransitionSessionInput {
  status?: string
  proposal?: string | null
  note?: string | null
  parentSessionId?: string | null
  reason?: string | null
}

export interface CommittedSessionChange {
  state: SessionState
  event: SessionEvent
  edge: TopologyEdge | null
  recipients: string[]
  messages: Message[]
}

export interface ProductionSessionApplication extends SessionApplication {
  readonly databasePath: string
  readonly protocol: SessionProtocol
  readonly topology: SessionTopology
  readonly events: SessionEventStore
  readonly runtimeBindings: SessionRuntimeBindings
  createSession(input: CreateSessionInput): SessionState
  transitionSession(sessionId: string, input: TransitionSessionInput): CommittedSessionChange
  enqueueMessage(sessionId: string, message: MessageInput): Message
  attachWatcher(watcherSessionId: string, subjectSessionId: string, channel?: string): TopologyEdge
  detachWatcher(watcherSessionId: string, subjectSessionId: string, channel?: string): TopologyEdge
  listWatchers(watcherSessionId: string, channel?: string): TopologyEdge[]
  bindRuntime(sessionId: string, identity: NativeRuntimeIdentity, expectedGeneration?: number): RuntimeBinding
  resolveRuntime(sessionId: string, namespace: string): RuntimeBinding | null
  dequeueForRuntime(sessionId: string, namespace: string, expectedGeneration?: number): Message | null
  readState(sessionId: string): SessionState | null
  replayState(sessionId: string): SessionState | null
  close(): void
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

export interface NotificationResult {
  edge: TopologyEdge | null
  recipients: string[]
  messages: Message[]
}

interface StateRow extends Record<string, unknown> {
  session_id: string
  status: string
  parent_session_id: string | null
  updated_at_ms: number | bigint
  proposal: string | null
  note: string | null
}

const requirePath = (databasePath: string): void => {
  if (typeof databasePath !== 'string' || !isAbsolute(databasePath) || databasePath.startsWith('file:') || databasePath.includes('\0') || databasePath.endsWith('/')) {
    throw new TypeError('session application requires an explicit absolute databasePath naming a file')
  }
}

const requireId = (value: string, field: string): void => {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new TypeError(`${field} must be a valid protocol session id`)
}

const requireStatus = (value: string): void => {
  if (typeof value !== 'string' || !STATUS.test(value)) throw new TypeError('session status has an invalid grammar')
}

const eventId = (): string => randomBytes(16).toString('hex')

const readStateInTransaction = (tx: ProtocolTransaction, sessionId: string): SessionState | null => {
  const row = tx.query(
    'SELECT session_id, status, proposal, note, parent_session_id, updated_at_ms FROM session_application_state WHERE session_id=?',
    sessionId,
  )[0] as StateRow | undefined
  return row
    ? {
        sessionId: String(row.session_id),
        status: String(row.status),
        proposal: row.proposal === null ? null : String(row.proposal),
        note: row.note === null ? null : String(row.note),
        parentSessionId: row.parent_session_id === null ? null : String(row.parent_session_id),
        updatedAtMs: Number(row.updated_at_ms),
      }
    : null
}

const messageForEvent = (state: SessionStateChange, id: string): MessageInput => ({
  kind: STATE_EVENT,
  body: encodeEventJson({
    eventId: id,
    sessionId: state.sessionId,
    status: state.status,
    proposal: state.proposal,
    note: state.note,
    previousProposal: state.previousProposal,
    previousNote: state.previousNote,
    parentSessionId: state.parentSessionId,
    previousStatus: state.previousStatus,
    previousParentSessionId: state.previousParentSessionId,
    reason: state.reason,
  }),
  senderSessionId: state.sessionId,
  idempotencyKey: id,
})

export function openProjectSessionApplication(options: ProjectSessionApplicationOptions): ProductionSessionApplication {
  requirePath(options.databasePath)
  if (typeof options.locality !== 'function') throw new TypeError('session application requires a locality precondition')
  options.locality(options.databasePath)
  const existing = compositions.get(options.databasePath)
  if (existing) return existing

  const protocol = openProtocolOnce(options.databasePath, options.now)
  applyComponentMigrations(protocol, 'session-application', SESSION_APPLICATION_MIGRATIONS)
  const topology = openTopology(protocol)
  const events = openSessionEvents(protocol)
  const runtimeBindings = openRuntimeBindings(protocol)
  const now = options.now ?? (() => Date.now())
  const initialized = new Set<string>()

  const initialize = (sessionId: string): void => {
    requireId(sessionId, 'sessionId')
    if (!initialized.has(sessionId)) {
      protocol.initialize(sessionId)
      initialized.add(sessionId)
    }
  }

  const notifyCommitted = (result: CommittedSessionChange): void => {
    options.onCommitted?.(result)
  }

  const app: ProductionSessionApplication = {
    databasePath: options.databasePath,
    protocol,
    topology,
    events,
    runtimeBindings,

    notifyRecipients(subjectSessionId, message) {
      return protocol.withTransaction(tx => {
        const recipients = topology.recipients(subjectSessionId, tx)
        const messages = recipients.map(recipient => tx.enqueue(recipient, {
          ...message,
          senderSessionId: message.senderSessionId === undefined ? subjectSessionId : message.senderSessionId,
        }))
        return { edge: null, recipients, messages }
      })
    },

    attachAndNotify(fromSessionId, subjectSessionId, relationType, message) {
      return protocol.withTransaction(tx => {
        const edge = topology.attach(tx, fromSessionId, subjectSessionId, relationType)
        const recipients = topology.recipients(subjectSessionId, tx)
        const messages = recipients.map(recipient => tx.enqueue(recipient, {
          ...message,
          senderSessionId: message.senderSessionId === undefined ? subjectSessionId : message.senderSessionId,
        }))
        return { edge, recipients, messages }
      })
    },

    createSession(input) {
      requireId(input.sessionId, 'sessionId')
      const status = input.status ?? 'created'
      requireStatus(status)
      const proposal = input.proposal ?? null
      const note = input.note ?? null
      const parentSessionId = input.parentSessionId ?? null
      if (parentSessionId !== null) requireId(parentSessionId, 'parentSessionId')
      initialize(input.sessionId)
      if (parentSessionId) initialize(parentSessionId)
      const created = protocol.withTransaction(tx => {
        if (readStateInTransaction(tx, input.sessionId)) {
          throw new Error(`session application state already exists: ${input.sessionId}`)
        }
        let edge: TopologyEdge | null = null
        if (parentSessionId) edge = topology.attach(tx, parentSessionId, input.sessionId, PARENT_RELATION)
        const updatedAtMs = input.updatedAtMs ?? now()
        tx.exec(
          'INSERT INTO session_application_state(session_id,status,proposal,note,parent_session_id,updated_at_ms) VALUES(?,?,?,?,?,?)',
          input.sessionId,
          status,
          proposal,
          note,
          parentSessionId,
          updatedAtMs,
        )
        const id = input.eventId ?? eventId()
        const change: SessionStateChange = {
          sessionId: input.sessionId,
          status,
          proposal,
          note,
          previousProposal: null,
          previousNote: null,
          parentSessionId,
          previousStatus: null,
          previousParentSessionId: null,
          reason: 'create',
        }
        const event = events.append(tx, {
          eventId: id,
          type: STATE_EVENT,
          schemaVersion: 1,
          subjectSessionId: input.sessionId,
          payload: encodeEventJson(change),
          occurredAtMs: updatedAtMs,
        })
        const recipients = topology.recipients(input.sessionId, tx)
        const messages = recipients.map(recipient => tx.enqueue(recipient, messageForEvent(change, id)))
        let runtime: RuntimeBinding | null = null
        if (input.runtime) {
          runtime = runtimeBindings.bind(tx, input.sessionId, input.runtime)
        }
        return {
          state: { sessionId: input.sessionId, status, proposal, note, parentSessionId, updatedAtMs },
          event,
          edge,
          recipients,
          messages,
          runtime,
        }
      })
      const result: CommittedSessionChange = {
        state: created.state,
        event: created.event,
        edge: created.edge,
        recipients: created.recipients,
        messages: created.messages,
      }
      notifyCommitted(result)
      return created.state
    },

    transitionSession(sessionId, input) {
      requireId(sessionId, 'sessionId')
      const nextStatus = input.status
      if (nextStatus !== undefined) requireStatus(nextStatus)
      if (input.parentSessionId !== undefined && input.parentSessionId !== null) requireId(input.parentSessionId, 'parentSessionId')
      if (input.parentSessionId === sessionId) throw new TypeError('a session cannot be its own parent')
      if (input.parentSessionId) initialize(input.parentSessionId)
      const result = protocol.withTransaction(tx => {
        const current = readStateInTransaction(tx, sessionId)
        if (!current) {
          throw new Error(`session application state is missing: ${sessionId}`)
        }
        const status = nextStatus ?? current.status
        const proposal = input.proposal === undefined ? current.proposal : input.proposal
        const note = input.note === undefined ? current.note : input.note
        const parentSessionId = input.parentSessionId === undefined ? current.parentSessionId : input.parentSessionId
        let edge: TopologyEdge | null = null
        if (parentSessionId !== current.parentSessionId) {
          if (parentSessionId && current.parentSessionId) edge = topology.reparent(tx, sessionId, parentSessionId, PARENT_RELATION)
          else if (parentSessionId) edge = topology.attach(tx, parentSessionId, sessionId, PARENT_RELATION)
          else if (current.parentSessionId) {
            const former = topology.parents(sessionId, PARENT_RELATION, tx)[0]
            if (former) topology.detach(tx, former.edgeId)
          }
        }
        const updatedAtMs = now()
        tx.exec(
          'UPDATE session_application_state SET status=?, proposal=?, note=?, parent_session_id=?, updated_at_ms=? WHERE session_id=?',
          status,
          proposal,
          note,
          parentSessionId,
          updatedAtMs,
          sessionId,
        )
        const id = eventId()
        const change: SessionStateChange = {
          sessionId,
          status,
          proposal,
          note,
          previousProposal: current.proposal,
          previousNote: current.note,
          parentSessionId,
          previousStatus: current.status,
          previousParentSessionId: current.parentSessionId,
          reason: input.reason ?? null,
        }
        const event = events.append(tx, {
          eventId: id,
          type: STATE_EVENT,
          schemaVersion: 1,
          subjectSessionId: sessionId,
          payload: encodeEventJson(change),
          occurredAtMs: updatedAtMs,
        })
        const recipients = topology.recipients(sessionId, tx)
        const messages = recipients.map(recipient => tx.enqueue(recipient, messageForEvent(change, id)))
        return {
          state: { sessionId, status, proposal, note, parentSessionId, updatedAtMs },
          event,
          edge,
          recipients,
          messages,
        }
      })
      notifyCommitted(result)
      return result
    },

    enqueueMessage(sessionId, message) {
      requireId(sessionId, 'sessionId')
      initialize(sessionId)
      return protocol.withTransaction(tx => tx.enqueue(sessionId, message))
    },

    attachWatcher(watcherSessionId, subjectSessionId, channel = WATCH_RELATION) {
      requireId(watcherSessionId, 'watcherSessionId')
      requireId(subjectSessionId, 'subjectSessionId')
      initialize(watcherSessionId)
      initialize(subjectSessionId)
      return protocol.withTransaction(tx => topology.subscribe(tx, watcherSessionId, subjectSessionId, channel))
    },

    detachWatcher(watcherSessionId, subjectSessionId, channel = WATCH_RELATION) {
      requireId(watcherSessionId, 'watcherSessionId')
      requireId(subjectSessionId, 'subjectSessionId')
      return protocol.withTransaction(tx => topology.unsubscribe(tx, watcherSessionId, subjectSessionId, channel))
    },

    listWatchers(watcherSessionId, channel = WATCH_RELATION) {
      requireId(watcherSessionId, 'watcherSessionId')
      return topology.subscriptions(watcherSessionId).filter(edge => edge.relationType === channel)
    },

    bindRuntime(sessionId, identity, expectedGeneration) {
      requireId(sessionId, 'sessionId')
      initialize(sessionId)
      return protocol.withTransaction(tx => runtimeBindings.bind(tx, sessionId, identity, { expectedGeneration }))
    },

    resolveRuntime(sessionId, namespace) {
      requireId(sessionId, 'sessionId')
      return runtimeBindings.resolve(namespace, sessionId)
    },

    dequeueForRuntime(sessionId, namespace, expectedGeneration) {
      requireId(sessionId, 'sessionId')
      const binding = runtimeBindings.resolve(namespace, sessionId)
      if (!binding || binding.status !== 'bound') throw new Error(`runtime binding is not active for ${sessionId}`)
      if (expectedGeneration !== undefined && binding.bindingGeneration !== expectedGeneration) {
        throw new Error(`runtime binding generation is stale for ${sessionId}`)
      }
      return protocol.dequeue(sessionId)
    },

    readState(sessionId) {
      requireId(sessionId, 'sessionId')
      const state = protocol.withTransaction(tx => readStateInTransaction(tx, sessionId))
      return state
    },

    replayState(sessionId) {
      requireId(sessionId, 'sessionId')
      initialize(sessionId)
      return events.replay<SessionState | null>(sessionId, {
        initialState: null,
        reducers: {
          [STATE_EVENT]: (_state, event) => {
            const decoded = JSON.parse(new TextDecoder().decode(event.payload)) as SessionStateChange
            return {
              sessionId: decoded.sessionId,
              status: decoded.status,
              proposal: decoded.proposal ?? null,
              note: decoded.note ?? null,
              parentSessionId: decoded.parentSessionId,
              updatedAtMs: event.occurredAtMs,
            }
          },
        },
      })
    },

    close() {
      compositions.delete(options.databasePath)
      closeProtocol(options.databasePath, protocol)
    },
  }
  compositions.set(options.databasePath, app)
  return app
}

const protocols = new Map<string, SessionProtocol>()

function openProtocolOnce(databasePath: string, now?: () => number): SessionProtocol {
  const existing = protocols.get(databasePath)
  if (existing) return existing
  const protocol = openProtocol(databasePath, now ? { now } : undefined)
  protocols.set(databasePath, protocol)
  return protocol
}

function closeProtocol(databasePath: string, protocol: SessionProtocol): void {
  if (protocols.get(databasePath) !== protocol) return
  protocols.delete(databasePath)
  protocol.close()
}
