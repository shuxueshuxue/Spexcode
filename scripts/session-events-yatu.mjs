import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openProtocol } from '@spexcode/session-protocol'
import { decodeEventJson, encodeEventJson, openSessionEvents } from '@spexcode/session-events'

const root = mkdtempSync(join(tmpdir(), 'session-events-yatu-'))
const databasePath = join(root, 'session.sqlite')
const eventId = '0123456789abcdef0123456789abcdef'

let protocol = openProtocol(databasePath, { now: () => 10 })
protocol.initialize('child')
protocol.initialize('parent')
let events = openSessionEvents(protocol)
protocol.withTransaction(tx => {
  const event = events.append(tx, {
    eventId,
    type: 'session.state.changed',
    schemaVersion: 1,
    subjectSessionId: 'child',
    payload: encodeEventJson({ next: 'review' }),
    occurredAtMs: 20,
  })
  tx.enqueue('parent', {
    kind: 'session.event.reference',
    body: encodeEventJson({ eventId: event.eventId }),
    idempotencyKey: `event:${event.eventId}:parent`,
  })
})
protocol.close()

protocol = openProtocol(databasePath, { now: () => 30 })
events = openSessionEvents(protocol)
try {
  const projection = events.replay('child', {
    initialState: { status: 'working' },
    reducers: {
      'session.state.changed': (state, event) => ({
        ...state,
        status: decodeEventJson(event.payload).next,
      }),
    },
  })
  const message = protocol.dequeue('parent')
  assert.equal(projection.status, 'review')
  assert.equal(decodeEventJson(message?.body ?? new Uint8Array()).eventId, eventId)
  assert.equal(events.read('child')[0].eventSeq, 1)
  console.log(JSON.stringify({
    scenario: 'installed-session-events-clean-consumer',
    eventId,
    eventSeq: 1,
    projectionStatus: projection.status,
    deliveredReference: true,
  }))
} finally {
  protocol.close()
}
