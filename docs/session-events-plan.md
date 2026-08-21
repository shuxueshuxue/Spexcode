# Session Events: Minimum Durable Contract

`@spexcode/session-events` is the same-database fact log below an application service. It is intentionally smaller
than the target sketch in `session-events-architecture.html`: the shared package does not own `SessionProjection`,
artifact resolution, code-version pinning, live observers, command admission, or external-effect replay.

## Public shape

```ts
const events = openSessionEvents(protocol)

protocol.withTransaction(tx => {
  const event = events.append(tx, {
    eventId: '0123456789abcdef0123456789abcdef',
    type: 'session.state.changed',
    schemaVersion: 1,
    subjectSessionId: childId,
    payload: encodeEventJson({ next: 'review' }),
    occurredAtMs: 100,
  })

  tx.enqueue(parentId, {
    kind: 'session.event.reference',
    body: encodeEventJson({ eventId: event.eventId }),
  })
})

const projection = events.replay(childId, {
  initialState: { status: 'working' },
  reducers: {
    'session.state.changed': (state, event) => ({
      ...state,
      status: decodeEventJson(event.payload).next,
    }),
  },
})
```

The event store and protocol message commit together because both use the caller's live `ProtocolTransaction`. There
is no outbox and no second SQLite connection. A listener later dequeues the message reference; delivery is not replay.

## Determinism and limits

The package fixes the bytes and order presented to a reducer. `encodeEventJson` accepts only lossless JSON data and
uses stable object-key ordering; arbitrary binary payloads remain valid through `Uint8Array`. Reads return a fresh
payload buffer, so mutation never changes the database.

The caller still owns reducer purity, referenced-object resolution, and the code version. Replaying this stream must
not resend mail, invoke a model, mutate Git, enqueue protocol messages, or repeat any other external side effect.
Those operations need their own explicit recovery/idempotency contracts.

Unknown event handling is local and durable: missing reducer + `ignorable: false` is an error; missing reducer +
`ignorable: true` is skipped. A writer uses `ignorable` only when omitting that fact cannot change the projection the
reader claims to reconstruct.
