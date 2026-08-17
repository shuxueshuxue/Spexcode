---
title: runtime-session
status: active
hue: 280
desc: External runtimes register compatible session addresses and publish revisioned state through the canonical record, timeline, parent watch, and pending queue without ceding process control to SpexCode.
code:
  - packages/session-core/src/runtime-session.ts
related:
  - packages/session-core/src/index.ts
  - packages/session-core/src/session-protocol.test.ts
  - packages/spec-core/src/layout.ts
---
# runtime-session

An external runtime may use SpexCode's durable session communication without becoming a SpexCode-managed
harness. `registerRuntimeSession` writes the canonical `session.json` address and, for a child, the canonical
`parent` watch relation. Such a record is `governed:false`: the runtime owns launch, liveness, stop, and cleanup,
while the package owns only the compatible file protocol and its locks.

Registration may carry an opaque string metadata map for the external runtime's own durable address fields. The
package validates and returns those bytes, includes them in registration replay identity, and never interprets them
as lifecycle, delivery, process, or authorization policy.

Registration defers a child's initial snapshot. `publishRuntimeSessionState` publishes one caller-owned revision
across the current record, Spex-compatible lifecycle timeline, parent watch, and parent's ordinary pending queue.
Each pending item carries an immutable structured snapshot of that revision, state, lifecycle projection, and note;
the private timeline receipt binds those attributes together with the transport text. A consumer therefore sees
`running`, then `idle`, then `need_review` in publication order even if it drains only after the current record has
already advanced to `need_review`. `runtimeSessionNotification` validates that snapshot against the registered
parent/runtime owner and joins it with the registration's opaque address metadata; consumers never parse display text
or substitute the current record for an older debt.
The richer runtime state remains opaque in the record; its Spex lifecycle/proposal is a projection for shared
readers. Replaying the same revision restores a receipt whose queue write was lost without duplicating settled
delivery. Replaying an older exact revision repairs only that revision's debt and never rolls the current record
back; binding any historical revision to different bytes fails before changing the record. The consumer drains the parent queue and
inserts the message into its own model/runtime channel; this package never starts or steers that runtime.

Parentlessness carries no generic declaration meaning here. A consumer may use its root only as a receiving
address and require declarations from workers, while SpexCode continues to require honest declarations from its
own governed top-level sessions. Role policy is supplied by the runtime, not inferred from `parent:null`.
