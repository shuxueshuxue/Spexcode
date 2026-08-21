import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openProtocol, ProtocolError } from '@spexcode/session-protocol'

import {
  decodeEventJson,
  encodeEventJson,
  openSessionEvents,
  SessionEventError,
} from './index.js'

const id = (digit: string): string => digit.repeat(32)

async function fixture(sessionIds = ['child', 'other']) {
  const root = await mkdtemp(join(tmpdir(), 'session-events-test-'))
  const protocol = openProtocol(join(root, 'session.sqlite'), { now: () => 50 })
  for (const sessionId of sessionIds) protocol.initialize(sessionId)
  return { protocol, events: openSessionEvents(protocol) }
}

test('per-subject sequences are contiguous and stored payload bytes are immutable snapshots', async () => {
  const { protocol, events } = await fixture()
  try {
    const payload = encodeEventJson({ next: 'review', value: 1 })
    const first = protocol.withTransaction(tx => events.append(tx, {
      eventId: id('1'), type: 'session.state.changed', schemaVersion: 1,
      subjectSessionId: 'child', payload, occurredAtMs: 100,
    }))
    payload.fill(0)
    const other = protocol.withTransaction(tx => events.append(tx, {
      eventId: id('2'), type: 'session.started', schemaVersion: 1,
      subjectSessionId: 'other', payload: encodeEventJson({ ok: true }), occurredAtMs: 110,
    }))
    const second = protocol.withTransaction(tx => events.append(tx, {
      eventId: id('3'), type: 'session.state.changed', schemaVersion: 1,
      subjectSessionId: 'child', payload: encodeEventJson({ next: 'done' }), occurredAtMs: 120,
    }))

    assert.equal(first.eventSeq, 1)
    assert.equal(other.eventSeq, 1)
    assert.equal(second.eventSeq, 2)
    const read = events.read('child')
    assert.deepEqual(decodeEventJson(read[0].payload), { next: 'review', value: 1 })
    read[0].payload.fill(0)
    assert.deepEqual(decodeEventJson(events.read('child')[0].payload), { next: 'review', value: 1 })
  } finally {
    protocol.close()
  }
})

test('append shares protocol rollback and prior events cannot be updated or deleted', async () => {
  const { protocol, events } = await fixture(['child'])
  try {
    assert.throws(() => protocol.withTransaction(tx => {
      events.append(tx, {
        eventId: id('4'), type: 'session.state.changed', schemaVersion: 1,
        subjectSessionId: 'child', payload: new Uint8Array([1]), occurredAtMs: 100,
      })
      throw new Error('caller rollback')
    }), /caller rollback/)
    assert.deepEqual(events.read('child'), [])

    protocol.withTransaction(tx => events.append(tx, {
      eventId: id('5'), type: 'session.state.changed', schemaVersion: 1,
      subjectSessionId: 'child', payload: new Uint8Array([1]), occurredAtMs: 100,
    }))
    assert.throws(
      () => protocol.withTransaction(tx => tx.exec('DELETE FROM session_events WHERE event_id=?', id('5'))),
      (error: unknown) => error instanceof ProtocolError && error.code === 'PROTOCOL_SQLITE_ERROR',
    )
    assert.equal(events.read('child').length, 1)
  } finally {
    protocol.close()
  }
})

test('replay skips only unknown ignorable events and rejects unknown required events', async () => {
  const { protocol, events } = await fixture(['child'])
  try {
    for (const input of [
      { eventId: id('6'), type: 'counter.added', ignorable: false, payload: encodeEventJson({ amount: 2 }) },
      { eventId: id('7'), type: 'display.hint', ignorable: true, payload: encodeEventJson({ color: 'blue' }) },
      { eventId: id('8'), type: 'counter.multiplied', ignorable: false, payload: encodeEventJson({ amount: 3 }) },
    ]) {
      protocol.withTransaction(tx => events.append(tx, {
        ...input, schemaVersion: 1, subjectSessionId: 'child', occurredAtMs: 100,
      }))
    }
    const reducers = {
      'counter.added': (state: number, event: { payload: Uint8Array }) =>
        state + Number((decodeEventJson(event.payload) as { amount: number }).amount),
    }
    assert.equal(events.replay('child', { initialState: 0, reducers, atSequence: 2 }), 2)
    assert.throws(
      () => events.replay('child', { initialState: 0, reducers }),
      (error: unknown) => error instanceof SessionEventError && error.code === 'EVENT_TYPE_UNKNOWN',
    )
  } finally {
    protocol.close()
  }
})

test('event envelopes and lossless JSON helpers fail before insert', async () => {
  const { protocol, events } = await fixture(['child'])
  try {
    assert.throws(() => encodeEventJson({ bad: Number.NaN }), SessionEventError)
    assert.throws(() => encodeEventJson({ bad: undefined }), SessionEventError)
    assert.throws(() => protocol.withTransaction(tx => events.append(tx, {
      eventId: 'not-an-id', type: 'counter.added', schemaVersion: 1,
      subjectSessionId: 'child', payload: new Uint8Array([1]), occurredAtMs: 1,
    })), SessionEventError)
    assert.deepEqual(events.read('child'), [])
  } finally {
    protocol.close()
  }
})
