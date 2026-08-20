---
title: session protocol production engine
status: active
hue: 280
desc: The synchronous production implementation of addresses, FIFO delivery, history, retirement, and bounded transactions.
code:
  - packages/session-protocol/src/engine.ts
related:
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
---
# session protocol production engine

This node owns the synchronous production implementation of the protocol operations and their transaction
boundaries. Opening establishes and verifies the frozen connection contract before schema or message work begins.
Writes reserve the database writer before reading mutable state; reads remain single statements over durable state;
and the shared transaction surface admits only SQL plus protocol enqueue.

The engine exposes no connection or partial operation. Re-entering a protocol write from a shared transaction is a
composition error with a direct repair instruction, and asynchronous transaction bodies are refused before commit.
Storage placement and locality are caller preconditions and have no implementation in this module.
