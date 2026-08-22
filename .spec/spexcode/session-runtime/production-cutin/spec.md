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

The Spex backend always composes the production session application through the existing self-launch
`resolveDatabasePath` precedence (`databasePath`, `SPEX_SESSION_DATABASE_PATH`, `SPEX_SESSION_CONFIG`, then the
per-user default). Before opening SQLite it runs the adopter locality precondition; a missing, relative, or non-local
path fails loudly. There is no `SPEXCODE_SESSION_DATABASE_PATH` opt-in and no JSON fallback.

The one-time JSON migration must complete before cutover. New `/api/sessions` records are initialized in the canonical
application database; `session.json` and `watchers.json`, when retained, are operational worktree metadata only and
are not read as application state, events, topology, or watcher authority.
The runtime API exposes only explicit watcher, state, event/replay, native binding, publish, and dequeue operations.
Native identity is caller supplied, and binding generation is checked by the shared runtime component. The YATU drives
the real HTTP backend, restarts it, replays the child state, publishes a durable watcher notification, and proves a
stale binding is refused.
