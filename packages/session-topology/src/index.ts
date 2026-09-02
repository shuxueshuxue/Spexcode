import { randomBytes } from 'node:crypto'

import { applyComponentMigrations } from '@spexcode/session-protocol'
import type { ProtocolTransaction, SessionProtocol } from '@spexcode/session-protocol'

import { failTopology, TopologyError } from './errors.js'
import { TOPOLOGY_MIGRATIONS } from './schema.js'

const EDGE_ID = /^[0-9a-f]{32}$/
const RELATION_TYPE = /^[0-9A-Za-z._:-]{1,64}$/
const SESSION_ID = /^(?!-)[0-9A-Za-z_-]{1,256}$/

interface EdgeRow extends Record<string, unknown> {
  edge_id: string
  from_session_id: string
  to_session_id: string
  relation_type: string
  created_at_ms: number | bigint
  removed_at_ms: number | bigint | null
}

const EDGE_COLUMNS = `edge_id, from_session_id, to_session_id, relation_type, created_at_ms, removed_at_ms`

export interface TopologyEdge {
  edgeId: string
  fromSessionId: string
  toSessionId: string
  relationType: string
  createdAtMs: number
  removedAtMs: number | null
}

export interface SessionTopology {
  attach(tx: ProtocolTransaction, fromSessionId: string, toSessionId: string, relationType: string): TopologyEdge
  detach(tx: ProtocolTransaction, edgeId: string): TopologyEdge
  reparent(
    tx: ProtocolTransaction,
    subjectSessionId: string,
    nextFromSessionId: string,
    relationType: string,
  ): TopologyEdge
  subscribe(
    tx: ProtocolTransaction,
    watcherSessionId: string,
    subjectSessionId: string,
    channel: string,
  ): TopologyEdge
  unsubscribe(
    tx: ProtocolTransaction,
    watcherSessionId: string,
    subjectSessionId: string,
    channel: string,
  ): TopologyEdge
  parents(sessionId: string, relationType?: string, tx?: ProtocolTransaction): TopologyEdge[]
  children(sessionId: string, relationType?: string, tx?: ProtocolTransaction): TopologyEdge[]
  subscriptions(sessionId: string, tx?: ProtocolTransaction): TopologyEdge[]
  recipients(subjectSessionId: string, tx?: ProtocolTransaction): string[]
}

export function openTopology(protocol: SessionProtocol): SessionTopology {
  applyComponentMigrations(protocol, 'session-topology', TOPOLOGY_MIGRATIONS)

  const requireTransaction = (tx: ProtocolTransaction): ProtocolTransaction => {
    if (
      !tx
      || typeof tx.exec !== 'function'
      || typeof tx.query !== 'function'
      || typeof tx.enqueue !== 'function'
    ) {
      failTopology('TOPOLOGY_TRANSACTION_INVALID', 'a live protocol transaction context is required')
    }
    return tx
  }

  const requireSessionId = (sessionId: string): void => {
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      failTopology('TOPOLOGY_SESSION_ID_INVALID', 'session id must match the protocol address grammar')
    }
  }

  const requireRelationType = (relationType: string): void => {
    if (typeof relationType !== 'string' || !RELATION_TYPE.test(relationType)) {
      failTopology(
        'TOPOLOGY_RELATION_TYPE_INVALID',
        'relation type must match [0-9A-Za-z._:-]{1,64}',
      )
    }
  }

  const requireEdgeId = (edgeId: string): void => {
    if (typeof edgeId !== 'string' || !EDGE_ID.test(edgeId)) {
      failTopology('TOPOLOGY_EDGE_ID_INVALID', 'edge id must be 32 lowercase hexadecimal characters')
    }
  }

  const toEdge = (row: EdgeRow): TopologyEdge => ({
    edgeId: String(row.edge_id),
    fromSessionId: String(row.from_session_id),
    toSessionId: String(row.to_session_id),
    relationType: String(row.relation_type),
    createdAtMs: Number(row.created_at_ms),
    removedAtMs: row.removed_at_ms === null ? null : Number(row.removed_at_ms),
  })

  const asEdgeRows = (rows: Record<string, unknown>[]): EdgeRow[] => rows as EdgeRow[]

  const requireAddresses = (tx: ProtocolTransaction, fromSessionId: string, toSessionId: string): void => {
    const rows = tx.query(
      'SELECT session_id FROM protocol_sessions WHERE session_id IN (?,?) ORDER BY session_id',
      fromSessionId,
      toSessionId,
    )
    const found = new Set(rows.map(row => String(row.session_id)))
    if (!found.has(fromSessionId) || !found.has(toSessionId)) {
      failTopology('TOPOLOGY_SESSION_UNKNOWN', 'one or more topology session addresses are unknown')
    }
  }

  const cycleExists = (
    tx: ProtocolTransaction,
    fromSessionId: string,
    toSessionId: string,
    relationType: string,
  ): boolean => tx.query(
    `WITH RECURSIVE reachable(session_id) AS (
       VALUES (?)
       UNION
       SELECT edge.to_session_id
       FROM topology_edges AS edge INDEXED BY topology_active_edge
       JOIN reachable ON edge.from_session_id=reachable.session_id
       WHERE edge.relation_type=? AND edge.removed_at_ms IS NULL
     )
     SELECT 1 AS present FROM reachable WHERE session_id=? LIMIT 1`,
    toSessionId,
    relationType,
    fromSessionId,
  ).length > 0

  const validateNewEdge = (
    tx: ProtocolTransaction,
    fromSessionId: string,
    toSessionId: string,
    relationType: string,
  ): void => {
    requireTransaction(tx)
    requireSessionId(fromSessionId)
    requireSessionId(toSessionId)
    requireRelationType(relationType)
    if (fromSessionId === toSessionId) {
      failTopology('TOPOLOGY_SELF_EDGE', 'an edge cannot point from a session to itself')
    }
    requireAddresses(tx, fromSessionId, toSessionId)
    if (cycleExists(tx, fromSessionId, toSessionId, relationType)) {
      failTopology('TOPOLOGY_CYCLE_REFUSED', 'the edge would create a relation cycle')
    }
  }

  const activeEdge = (
    tx: ProtocolTransaction,
    fromSessionId: string,
    toSessionId: string,
    relationType: string,
  ): EdgeRow | undefined => asEdgeRows(tx.query(
    `SELECT ${EDGE_COLUMNS} FROM topology_edges INDEXED BY topology_active_edge
     WHERE from_session_id=? AND to_session_id=? AND relation_type=? AND removed_at_ms IS NULL`,
    fromSessionId,
    toSessionId,
    relationType,
  ))[0]

  const insertEdge = (
    tx: ProtocolTransaction,
    fromSessionId: string,
    toSessionId: string,
    relationType: string,
  ): TopologyEdge => {
    const edgeId = randomBytes(16).toString('hex')
    const createdAtMs = Date.now()
    try {
      tx.exec(
        `INSERT INTO topology_edges
         (edge_id, from_session_id, to_session_id, relation_type, created_at_ms, removed_at_ms)
         VALUES (?,?,?,?,?,NULL)`,
        edgeId,
        fromSessionId,
        toSessionId,
        relationType,
        createdAtMs,
      )
    } catch (error) {
      const code = String((error as { code?: unknown })?.code ?? '')
      if (code.includes('UNIQUE') || code.includes('PRIMARYKEY')) {
        failTopology('TOPOLOGY_EDGE_EXISTS', 'the active topology edge already exists', error)
      }
      if (code.includes('FOREIGNKEY')) {
        failTopology('TOPOLOGY_SESSION_UNKNOWN', 'one or more topology session addresses are unknown', error)
      }
      failTopology('TOPOLOGY_STORAGE_ERROR', 'the topology edge could not be stored', error)
    }
    return { edgeId, fromSessionId, toSessionId, relationType, createdAtMs, removedAtMs: null }
  }

  const attach = (
    tx: ProtocolTransaction,
    fromSessionId: string,
    toSessionId: string,
    relationType: string,
  ): TopologyEdge => {
    validateNewEdge(tx, fromSessionId, toSessionId, relationType)
    if (activeEdge(tx, fromSessionId, toSessionId, relationType)) {
      failTopology('TOPOLOGY_EDGE_EXISTS', 'the active topology edge already exists')
    }
    return insertEdge(tx, fromSessionId, toSessionId, relationType)
  }

  const detach = (tx: ProtocolTransaction, edgeId: string): TopologyEdge => {
    requireTransaction(tx)
    requireEdgeId(edgeId)
    const row = asEdgeRows(tx.query(
      `SELECT ${EDGE_COLUMNS} FROM topology_edges WHERE edge_id=? AND removed_at_ms IS NULL`,
      edgeId,
    ))[0]
    if (!row) failTopology('TOPOLOGY_EDGE_UNKNOWN', 'the active topology edge does not exist')
    const removedAtMs = Date.now()
    const result = tx.exec(
      'UPDATE topology_edges SET removed_at_ms=? WHERE edge_id=? AND removed_at_ms IS NULL',
      removedAtMs,
      edgeId,
    )
    if (result.changes !== 1) {
      failTopology('TOPOLOGY_EDGE_UNKNOWN', 'the active topology edge does not exist')
    }
    return { ...toEdge(row), removedAtMs }
  }

  const withRead = <T>(tx: ProtocolTransaction | undefined, query: (active: ProtocolTransaction) => T): T => {
    if (tx !== undefined) return query(requireTransaction(tx))
    return protocol.withTransaction(query)
  }

  const queryEdges = (
    sessionId: string,
    relationType: string | undefined,
    tx: ProtocolTransaction | undefined,
    direction: 'from' | 'to',
  ): TopologyEdge[] => {
    requireSessionId(sessionId)
    if (relationType !== undefined) requireRelationType(relationType)
    return withRead(tx, active => {
      const index = direction === 'from' ? 'topology_active_edge' : 'topology_active_to'
      const column = direction === 'from' ? 'from_session_id' : 'to_session_id'
      const relation = relationType === undefined ? '' : ' AND relation_type=?'
      const params = relationType === undefined ? [sessionId] : [sessionId, relationType]
      return asEdgeRows(active.query(
        `SELECT ${EDGE_COLUMNS} FROM topology_edges INDEXED BY ${index}
         WHERE ${column}=? AND removed_at_ms IS NULL${relation}
         ORDER BY relation_type, from_session_id, to_session_id, created_at_ms, edge_id`,
        ...params,
      )).map(toEdge)
    })
  }

  return {
    attach,
    detach,
    reparent(tx, subjectSessionId, nextFromSessionId, relationType) {
      validateNewEdge(tx, nextFromSessionId, subjectSessionId, relationType)
      const removedAtMs = Date.now()
      tx.exec(
        `UPDATE topology_edges SET removed_at_ms=?
         WHERE to_session_id=? AND relation_type=? AND removed_at_ms IS NULL`,
        removedAtMs,
        subjectSessionId,
        relationType,
      )
      return insertEdge(tx, nextFromSessionId, subjectSessionId, relationType)
    },
    subscribe(tx, watcherSessionId, subjectSessionId, channel) {
      return attach(tx, watcherSessionId, subjectSessionId, channel)
    },
    unsubscribe(tx, watcherSessionId, subjectSessionId, channel) {
      requireTransaction(tx)
      requireSessionId(watcherSessionId)
      requireSessionId(subjectSessionId)
      requireRelationType(channel)
      const row = activeEdge(tx, watcherSessionId, subjectSessionId, channel)
      if (!row) failTopology('TOPOLOGY_EDGE_UNKNOWN', 'the active topology edge does not exist')
      return detach(tx, String(row.edge_id))
    },
    parents(sessionId, relationType, tx) {
      return queryEdges(sessionId, relationType, tx, 'to')
    },
    children(sessionId, relationType, tx) {
      return queryEdges(sessionId, relationType, tx, 'from')
    },
    subscriptions(sessionId, tx) {
      return queryEdges(sessionId, undefined, tx, 'from')
    },
    recipients(subjectSessionId, tx) {
      requireSessionId(subjectSessionId)
      return withRead(tx, active => active.query(
        `SELECT DISTINCT from_session_id FROM topology_edges INDEXED BY topology_active_to
         WHERE to_session_id=? AND removed_at_ms IS NULL ORDER BY from_session_id`,
        subjectSessionId,
      ).map(row => String(row.from_session_id)))
    },
  }
}

export { TopologyError }
export type { TopologyErrorCode } from './errors.js'
