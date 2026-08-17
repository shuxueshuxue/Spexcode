---
title: runtime-session
status: active
hue: 280
desc: The compatibility bridge that currently mixes external-runtime records, topology, projection, and message publication while those concerns move to their owning layers.
code:
  - packages/session-core/src/runtime-session.ts
related:
  - packages/session-core/src/index.ts
  - packages/session-core/src/session-protocol.test.ts
  - packages/spec-core/src/layout.ts
---
# runtime-session

`runtime-session.ts` is the existing ZCode-oriented compatibility bridge, not part of the final
[[session-protocol]] language. It currently registers an external runtime record, writes `parent` and
`watchers.json`, projects runtime state into Spex lifecycle words, composes parent notifications, and enqueues
them. Those are four valid operations owned by different layers; their co-location is migration evidence, not a
public abstraction to copy into another adopter.

The bridge remains compatible while adopters move:

- address initialization and fixed message enqueue/dequeue move to the published protocol;
- parent/child and subscription relations move to [[session-topology]] or adopter-owned topology policy;
- lifecycle projection and notification composition move to the adopter's [[session-runtime]];
- launch, liveness, stop, sockets, and native steering remain in its harness runtime adapter.

No new consumer should call `registerRuntimeSession` or `publishRuntimeSessionState` as a universal session API.
Once Z-Storm and Spex governed composition use the split contracts, this module leaves the public entry and may
remain only as a versioned compatibility adapter. Its revision-keyed crash recovery must be preserved by the
adopter's topology outbox plus protocol idempotency; migration must not trade a mixed boundary for lost state.
