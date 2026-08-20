---
title: session topology errors
status: active
hue: 280
desc: Stable topology-owned failures that do not widen or impersonate the protocol error language.
code:
  - packages/session-topology/src/errors.ts
related:
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-protocol/errors/spec.md
---
# session topology errors

Topology validation, unknown edges, duplicate active edges, cycle refusal, unknown session addresses, invalid
transaction contexts, and storage failures have stable `TOPOLOGY_*` codes. Protocol codes remain protocol property.
SQLite diagnostics may be retained as error causes for debugging but never become the topology message surface.
