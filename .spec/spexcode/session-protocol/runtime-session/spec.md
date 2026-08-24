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

`runtime-session.ts` is the existing ZCode-oriented mixed bridge, not part of the final
[[session-protocol]] language. It currently registers an external runtime record, writes `parent` and
`watchers.json`, projects runtime state into Spex lifecycle words, composes parent notifications, and enqueues
them. Those are four valid operations owned by different layers; their co-location is migration evidence, not a
public abstraction to copy into another adopter.

The migration moves each responsibility directly; the bridge is not a supported compatibility layer:

- address initialization and fixed message enqueue/dequeue move to the published protocol;
- parent/child and subscription relations move to [[session-topology]] or adopter-owned topology policy;
- lifecycle projection and notification composition move to the adopter's [[session-runtime]];
- launch, liveness, stop, sockets, and native steering remain in its harness runtime adapter.

No new consumer should call `registerRuntimeSession` or `publishRuntimeSessionState` as a universal session API.
Once ZSwarm and Spex governed composition use the split contracts, this module is deleted from the public entry and
from the source tree. Its revision-keyed recovery is preserved by the owning topology transaction and protocol
idempotency; a permanent bridge or outbox is not an acceptable migration substitute.

While this bridge remains, its lifecycle projection has one writable source: the append-only session timeline.
Registration and publication scrub the legacy `status`, `proposal`, and `note` keys from `session.json`; replaying
an older record migrates its last valid values into a status event before the file is rewritten. The JSON file keeps
only operational and topology metadata, so a consumer cannot accidentally treat the compatibility projection as a
second lifecycle authority.
