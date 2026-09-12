---
title: session runtime production cut-in yatu
status: active
hue: 280
desc: Real backend proof for the configured Spex session runtime composition.
code:
  - spec-cli/src/session-production-cutover.yatu.test.ts
related:
  - .spec/spexcode/session-runtime/application-service/production-cutin/spec.md
---
# session runtime production cut-in yatu

The fixture starts the actual Spex backend with an explicit local database path, creates canonical parent/child rows and
their governed runtime envelopes, changes child state, reads its typed event, restarts the backend, replays the event,
binds an explicit native identity, rejects a stale generation, publishes a notification, and dequeues it through the
watching session. State transitions append events; the backend that owns the watcher records reconciles those cursors
into ordinary queue messages before dequeue, while a relation created after an earlier publish does not receive that
history. The fixture also proves one-time migration marker behavior and independent watcher pairs.

The protocol's sequence scope stays explicit in the proof: `enqueueSeq` is global to the message table, so independent
watcher queues may contain interleaved sequence values, and the proof requires FIFO within each recipient and identical
payload order across recipients, not equal sequence numbers between recipients. There is one proof of this composition,
the backend HTTP fixture above; the earlier in-process rehearsal script asserted the pre-reconciliation delivery order and
was retired rather than kept as a second contract that could drift.
