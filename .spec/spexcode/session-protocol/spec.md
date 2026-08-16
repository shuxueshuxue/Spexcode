---
title: session-protocol
status: active
hue: 280
desc: The reusable durable session protocol: file-backed timelines, cursors, pending delivery debt, and their locks, while runtime control stays with the consumer.
code:
  - packages/session-core/src/index.ts
related:
  - packages/session-core/src/internal.ts
  - packages/session-core/src/message.ts
  - packages/session-core/src/record-lock.ts
  - packages/session-core/src/session-timeline.ts
  - packages/session-core/src/session-cursors.ts
  - packages/session-core/src/delivery-queue.ts
  - packages/session-core/src/session-protocol.test.ts
  - packages/session-core/scripts/public-boundary.test.mjs
  - packages/session-core/package.json
  - packages/session-core/tsconfig.build.json
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/sessions.ts
---
# session-protocol

`@spexcode/session-core` is the reusable boundary for SpexCode's file-based session communication protocol.
It owns the durable timeline format, follow cursors, pending delivery queue, sender revocation, and delivery
locking. SpexCode CLI and external runtimes import the same implementation; neither rewrites these files or
reimplements their ordering and crash rules.

The package owns durable facts in the canonical SpexCode per-project session store and accepts runtime effects
as callbacks. In particular, `drain(sessionId, insert)` owns claim/order/remove around a debt, while the
consumer owns the harness delivery callback. Launching, stopping, liveness, tmux, sockets, Codex RPC, ZCode
app-server control, prompt composition, and watch policy remain outside this package. `governed` is a
SpexCode product projection and lifecycle policy, not permission to read a timeline or drain a queue.

`acceptMessage` is the public write boundary: it owns the sorted record fences, timeline receipt, queue
publication, keyed replay, and recovery of a receipt whose queue write was lost. Product validation and prompt
composition are callbacks run inside that boundary. `drain` validates a keyed head against its frozen receipt,
settles an accepted insert, and consumes a crash-left settled head without reinserting it. The public entry
exposes these complete operations and read models; `./internal` exists only for SpexCode CLI's larger
close/reparent/lifecycle transactions and does not ask external runtimes to reconstruct half a send.

The first dependency direction is `session-core -> spec-core`: it reuses the current canonical global-store
paths and lifecycle value types. `spec-core` does not import `session-core`, and no harness adapter is reachable
from the package. Moving the remaining session-record path/schema out of `spec-core/layout.ts` requires the
graph to consume an injected session projection first; that later migration must not introduce a cycle merely
to make the directory name look cleaner.
