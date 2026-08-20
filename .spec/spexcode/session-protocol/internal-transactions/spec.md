---
title: internal-transactions
status: active
hue: 280
desc: A named internal package entry lets SpexCode CLI compose larger lifecycle transactions without exposing half-operations as the public runtime API.
code:
  - packages/session-core/src/internal.ts
related:
  - packages/session-core/src/index.ts
  - spec-cli/src/sessions.ts
---
# internal-transactions

The public package entry exposes complete communication operations. SpexCode CLI also owns close, reparent,
archive, and lifecycle transactions that must combine exact queue snapshots, sender revocation, and record
fences with product state. Those primitives are exported only through `@spexcode/session-core/internal` so the
composition layer reuses the same lock and codec while external runtime consumers are directed to
`acceptMessage` and `drain`, not a sequence of half-writes.
