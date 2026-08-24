---
title: internal-transactions
status: active
hue: 280
desc: A named internal package entry lets SpexCode CLI compose larger lifecycle transactions without exposing half-operations as the public runtime API.
code:
  - packages/session-protocol/src/engine.ts
related:
  - packages/session-protocol/src/index.ts
  - spec-cli/src/sessions.ts
---
# internal-transactions

The public `@spexcode/session-protocol` entry exposes complete communication operations. Product lifecycle and
resource transactions belong to `@spexcode/session-application` and the CLI, which compose the protocol's public
transaction callback with their own state tables. There is no `@spexcode/session-core/internal` compatibility
entry: external consumers use complete protocol operations, while Spex-only lifecycle code stays above the neutral
protocol boundary.
