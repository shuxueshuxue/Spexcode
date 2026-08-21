# Session application service

The package is deliberately small. `session-protocol` owns opaque messages and SQLite commits; `session-topology`
owns opaque relationships and recipient queries; `session-application` is the adopter-owned unit-of-work facade
that composes them.

```text
adopter action
    |
    v
session-application  -- one protocol.withTransaction
    |                 \ topology.attach / topology.recipients
    |                  \ tx.enqueue(recipient, message)
    v
session-protocol     (commit or rollback)
```

The public surface has two actions:

```ts
app.notifyRecipients(subjectSessionId, message)
app.attachAndNotify(fromSessionId, subjectSessionId, relationType, message)
```

It is not an event-sourcing package. Events, lifecycle state, runtime bindings, native harness effects, dequeue,
replay, and wake hints remain adopter concerns. A future event model can call this service, but this package does not
pretend that a protocol message is an event or create a second durable feed.
