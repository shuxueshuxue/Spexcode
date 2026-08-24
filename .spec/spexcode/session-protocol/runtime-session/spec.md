---
title: runtime-session
status: active
hue: 280
desc: The temporary mixed bridge being dismantled as external-runtime records, topology, projection, and message publication return to their owning layers.
code:
  - packages/session-runtime/src/index.ts
related:
  - packages/session-runtime/src/index.test.ts
  - packages/spec-core/src/layout.ts
---
# runtime-session

The former ZCode-oriented `runtime-session.ts` bridge is retired. It is not part of the public package surface and
must not be restored as a compatibility layer. Its old responsibilities now have explicit owners: protocol
addresses and messages in [[session-protocol]], relations in [[session-topology]], lifecycle/events/watch delivery
in [[session application service]], and native identity in [[runtime-bindings]].

The migration keeps each responsibility at its owner; the bridge is not a supported compatibility layer:

- address initialization and fixed message enqueue/dequeue move to the published protocol;
- parent/child and subscription relations move to [[session-topology]] or adopter-owned topology policy;
- lifecycle projection and notification composition move to the adopter's [[session-runtime]];
- launch, liveness, stop, sockets, and native steering remain in its harness runtime adapter.

No new consumer should call `registerRuntimeSession` or `publishRuntimeSessionState` as a universal session API.
Once ZSwarm and Spex governed composition use the split contracts, this module is deleted from the public entry and
from the source tree. Its revision-keyed recovery is preserved by the owning topology transaction and protocol
idempotency; a permanent bridge or outbox is not an acceptable migration substitute.

One-time migration may read old JSON and timeline inputs, replay their last valid values into the canonical
application event store, and retire those inputs. Normal runtime never reads or writes them and never exposes a
second lifecycle authority.
