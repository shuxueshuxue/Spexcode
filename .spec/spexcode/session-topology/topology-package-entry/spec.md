---
title: session topology package entry
status: active
hue: 280
desc: The internal neutral relation API and its bounded synchronous composition with protocol enqueue.
code:
  - packages/session-topology/src/index.ts
related:
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-protocol/package-entry/spec.md
---
# session topology package entry

The package entry exposes one neutral edge model. Attachment and subscription are vocabulary over the same directed
edge relation, and recipient resolution returns the distinct active sources pointing at one subject in stable order.
It decides neither message content nor whether a relation change requires a message.
`descendants(sessionId, relationType?, tx?)` recursively traverses active edges and returns every reachable session
id in stable order, crossing intermediate lifecycle states because topology stores no lifecycle policy.

Every mutation accepts a live protocol transaction context and performs only bounded synchronous SQL and in-memory
validation. The caller may enqueue zero or more messages on that same context, so the outer protocol transaction is
the sole commit and rollback authority. The topology package never starts or commits a transaction and exposes no
way to combine relation mutation with taking a message.

Reads normally open a short protocol transaction; callers already inside one may pass that transaction explicitly so
queries observe the same uncommitted relation state without transaction re-entry.
