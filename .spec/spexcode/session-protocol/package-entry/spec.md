---
title: session protocol package entry
status: active
hue: 280
desc: The exact published TypeScript and JavaScript surface of the production protocol package.
code:
  - packages/session-protocol/src/index.ts
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# session protocol package entry

This node owns the one published entry through which consumers open the protocol, compose a transaction, apply a
component migration, inspect stable constants, and use the protocol's types. It re-exports complete operations and
read models while keeping connection handles, inspection helpers, and partial writes private.

The entry has one spelling for each capability and no compatibility aliases or internal package subpath. Its runtime
keys and generated declarations are both part of the boundary: adding an export is a contract change even when no
current consumer imports it.
`MESSAGE_KINDS` declares `session.text.v1`, `spec.change-report.v1`, and `zcode.swarm.state` without narrowing the
protocol's open kind grammar.
