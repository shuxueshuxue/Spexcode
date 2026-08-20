export type TopologyErrorCode = 'TOPOLOGY_NOT_IMPLEMENTED'

export class TopologyError extends Error {
  readonly code: TopologyErrorCode

  constructor(code: TopologyErrorCode, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'TopologyError'
    this.code = code
  }
}
