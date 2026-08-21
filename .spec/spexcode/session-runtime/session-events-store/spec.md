---
title: session events store
status: active
hue: 280
desc: Transaction-bound append, ordered read, and explicit replay fold operations.
code:
  - packages/session-events/src/index.ts
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# session events store

The store accepts a live protocol transaction for append and may accept one for reads. Without an explicit read
transaction it creates one bounded protocol transaction. Replay reads one validated range, skips only unknown events
whose envelope is ignorable, and applies caller reducers in sequence without interpreting their state.
