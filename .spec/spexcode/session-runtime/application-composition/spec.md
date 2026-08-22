---
title: session application composition
status: active
hue: 280
desc: The cached one-database composition that joins protocol, topology, events, and runtime bindings.
code:
  - packages/session-application/src/production.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# session application composition

`openProjectSessionApplication` requires one explicit absolute database path and a locality precondition before it
opens protocol. It caches one composition per path, initializes each component once, and closes the shared protocol
handle only when that composition closes. State/topology/event/message writes share one synchronous transaction;
post-commit callbacks are wake hints only. Runtime identities and generation expectations are always caller supplied.
