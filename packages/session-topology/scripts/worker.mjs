import { openProtocol } from '@spexcode/session-protocol'
import { openTopology } from '../dist/index.js'

const [databasePath, operation, ...args] = process.argv.slice(2)
const protocol = openProtocol(databasePath)
const topology = openTopology(protocol)

if (operation === 'attach') {
  const [fromSessionId, toSessionId, relationType] = args
  const result = protocol.withTransaction(tx => {
    const edge = topology.attach(tx, fromSessionId, toSessionId, relationType)
    const message = tx.enqueue(toSessionId, {
      kind: 'relation.v1',
      body: Buffer.from(fromSessionId),
      senderSessionId: fromSessionId,
    })
    return { edgeId: edge.edgeId, messageId: message.messageId }
  })
  process.stdout.write(`${JSON.stringify({ operation, ...result })}\n`)
} else if (operation === 'inspect') {
  const [subjectSessionId] = args
  process.stdout.write(`${JSON.stringify({
    operation,
    recipients: topology.recipients(subjectSessionId),
    edges: topology.parents(subjectSessionId).length,
    messages: protocol.listPending(subjectSessionId).length,
  })}\n`)
} else {
  throw new Error(`unknown operation: ${operation}`)
}

protocol.close()
