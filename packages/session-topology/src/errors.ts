export type TopologyErrorCode =
  | 'TOPOLOGY_EDGE_ID_INVALID'
  | 'TOPOLOGY_EDGE_UNKNOWN'
  | 'TOPOLOGY_EDGE_EXISTS'
  | 'TOPOLOGY_CYCLE_REFUSED'
  | 'TOPOLOGY_RELATION_TYPE_INVALID'
  | 'TOPOLOGY_SESSION_ID_INVALID'
  | 'TOPOLOGY_SESSION_UNKNOWN'
  | 'TOPOLOGY_SELF_EDGE'
  | 'TOPOLOGY_TRANSACTION_INVALID'
  | 'TOPOLOGY_STORAGE_ERROR'

export class TopologyError extends Error {
  readonly code: TopologyErrorCode

  constructor(code: TopologyErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'TopologyError'
    this.code = code
  }
}

export function failTopology(code: TopologyErrorCode, message: string, cause?: unknown): never {
  throw new TopologyError(code, message, cause)
}
