---
title: session runtime production cut-in
status: active
hue: 280
desc: The explicit Spex backend composition hook for the adopter-owned session application service.
code:
  - spec-cli/src/session-application.ts
related:
  - .spec/spexcode/session-runtime/application-service/spec.md
  - .spec/spexcode/session-runtime/production-cutin-yatu/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# session runtime production cut-in

The Spex backend composes the production session application only when `SPEXCODE_SESSION_DATABASE_PATH` is supplied
as an explicit absolute path. Before opening SQLite it runs the adopter locality precondition; a missing, relative, or
non-local path fails loudly. With the setting absent, existing JSON-backed records retain their legacy authority and
the backend does not invent a database or silently migrate them.

New `/api/sessions` records are initialized in the configured protocol database after the legacy record is published.
The runtime API exposes only explicit watcher, state, event/replay, native binding, publish, and dequeue operations.
Native identity is caller supplied, and binding generation is checked by the shared runtime component. The YATU drives
the real HTTP backend, restarts it, replays the child state, publishes a durable watcher notification, and proves a
stale binding is refused.
