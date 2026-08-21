---
title: session events tests
status: active
hue: 280
desc: Executable package regressions for sequence, rollback, immutability, and unknown-type handling.
code:
  - packages/session-events/src/index.test.ts
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# session events tests

The package tests exercise the public store against a real protocol SQLite database. Their fail-first baseline is an
explicit not-implemented store, not a missing module, missing binary, or broken fixture.
