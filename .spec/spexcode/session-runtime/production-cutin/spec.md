---
title: session runtime production cut-in
status: active
hue: 280
desc: The explicit Spex backend composition hook for the adopter-owned session application service.
code:
  - spec-cli/src/session-application.ts
related:
  - spec-cli/src/index.ts
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

The only pre-marker exception is a fresh project with no legacy session directories: it may initialize an empty
canonical store. Once any legacy session directory exists, the application service and runtime API remain unavailable
until the migration marker is present; they must not create an unmarked SQLite store beside the JSON source.

The one-time JSON migration must complete before cutover. New `/api/sessions` records are initialized in the canonical
application database, and after the migration marker exists the list reads lifecycle status and parent topology from
that database, refusing a governed record with no canonical row; `session.json` and `watchers.json`, when retained,
are operational worktree metadata only and are not read as application state, events, topology, or watcher authority.
Lifecycle changes, watcher subscriptions, direct sends, and delivery after the marker use the application service and
canonical SQLite queue. A bound native runtime is required before dequeue; an unbound runtime leaves durable debt
pending and never falls back to `pending.json` or the legacy session-core timeline.
Concurrent or retried accepted creates may publish the same idempotency receipt more than once; the HTTP bridge
initializes its canonical row at most once and accepts a duplicate only when the existing projection matches.
The runtime API exposes only explicit watcher, state, event/replay, native binding, publish, and dequeue operations.
Native identity is caller supplied, and binding generation is checked by the shared runtime component. The YATU drives
the real HTTP backend, restarts it, replays the child state, publishes a durable watcher notification, and proves a
stale binding is refused.

Cutover is a maintenance operation, not a best-effort background import. The migration fence is taken before the
legacy source snapshot; old JSON writers reject it, and the importer rechecks the complete source set before SQLite
installation. Any writer that ignores the fence is evidence that the maintenance window is not quiet, so migration
must abort rather than publish a database with a partial view of the live store.
