---
title: session events package
status: active
hue: 280
desc: The installable public package surface for the session event store.
code:
  - packages/session-events/package.json
related:
  - .spec/spexcode/session-runtime/session-events/spec.md
---
# session events package

`@spexcode/session-events` depends only on `@spexcode/session-protocol` at runtime. Its package entry exports the event
types, error type, migration description, store factory, and byte/JSON helpers used by an external adopter.
