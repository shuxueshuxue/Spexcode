---
title: session topology schema
status: active
hue: 280
desc: The component-scoped migration and single directed-edge relation owned by session topology.
code:
  - packages/session-topology/src/schema.ts
related:
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# session topology schema

The topology component owns one `topology_edges` table in the adopter database. An active edge points from an
interested session address to the subject it follows. Soft removal is represented only by `removed_at_ms`; there is
no revision, replay key, product scope, role column, or second relation projection.

The component uses the protocol package's component migration mechanism under the fixed name `session-topology`.
Its active-edge indexes are part of the bounded query contract: from-oriented traversal uses the uniqueness index,
and subject-oriented recipient lookup uses the active-to index. Both hot paths pin their index so the plan does not
depend on planner statistics.
