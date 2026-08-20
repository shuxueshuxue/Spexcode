import { applyComponentMigrations } from '@spexcode/session-protocol'
import type { ProtocolTransaction, SessionProtocol } from '@spexcode/session-protocol'

import { TopologyError } from './errors.js'
import { TOPOLOGY_MIGRATIONS } from './schema.js'

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
  recipients(subjectSessionId: string, tx?: ProtocolTransaction): string[]
}

export function openTopology(protocol: SessionProtocol): SessionTopology {
  applyComponentMigrations(protocol, 'session-topology', TOPOLOGY_MIGRATIONS)
  return {
    attach(_tx, fromSessionId, toSessionId, relationType) {
      return {
        edgeId: '0'.repeat(32), fromSessionId, toSessionId, relationType,
        createdAtMs: 0, removedAtMs: null,
      }
    },
    recipients() { return [] },
  }
}

export { TopologyError }
export type { TopologyErrorCode } from './errors.js'
