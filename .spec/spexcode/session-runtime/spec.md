---
title: session-runtime
status: active
hue: 280
desc: The adopter-owned composition loop that combines protocol, optional topology, and one harness runtime adapter while setup remains orthogonal.
related:
  - .spec/spexcode/session-runtime/runtime-bindings/spec.md
---
# session-runtime

A session runtime is a consumer composition, not a daemon required by [[session-protocol]]. It may be a long-lived
Spex backend, a ZSwarm worker loop, or a short-lived self-launch listener. Its minimal loop is always the same:

1. open the protocol for one explicit absolute database path, obtain one exact session id, and initialize its
   protocol address;
2. optionally use [[session-topology]] to resolve related recipients;
3. enqueue complete messages for those addresses;
4. dequeue the local address;
5. pass each returned message to the selected harness runtime adapter.

The shared `session-application` package provides the adopter-owned state → event → watcher transaction service:
state, topology, event append, recipient resolution, and protocol enqueue commit together, while the optional
post-commit callback is only a wake hint. It also owns runtime binding and durable follow-cursor boundaries.
The package does not choose a product policy; Spex resolves parent/manual watch recipients and passes an explicit
set when its policy differs from neutral topology. No Spex or ZSwarm production cut-in is implied by a clean
consumer proof alone.

The runtime adapter owns native effects such as launch, ordinary input, interrupt, stop, liveness, and native
identity. The adopter-owned [[runtime-bindings]] component may bind the exact protocol address to the current
native identity with a generation fence. It may keep a handler journal keyed by protocol `messageId` when its own input
seam needs retry or exactly-once handling. The protocol does not call the adapter and the adapter does not edit
protocol tables.

Harness configuration is a separate materialization adapter. It owns discovered contract files, hook bindings,
trust, skills, commands, and other setup artifacts. One harness registry row may implement both runtime and
materialization facets, but neither facet calls or imports the other. A self-launched harness may therefore use
materialization plus a small protocol listener without importing the Spex managed runtime; ZSwarm may use its
runtime facet without adopting Spex materialization; Spex governed launch composes both.

The three reference compositions are:

- **ZSwarm:** `session-protocol + ZSwarm topology + ZSwarm runtime adapter`. ZSwarm state remains a versioned
  message body or its own record, never a Spex lifecycle field required by the protocol. Its existing injected
  mailbox port can implement dequeue directly; a multi-workspace app-server opens the exact adopter database and
  namespaces its own workspaces instead of mutating process cwd.
- **self-launch:** `materialize + session-protocol + explicit listener + harness runtime adapter`. There is no
  governed lifecycle record, board row, parent, resident backend, or automatic drain requirement.
- **Spex governed:** `session-protocol + Spex topology policy + Spex lifecycle/governance + harness runtime adapter
  + materialize`. Its backend improves latency and owns runtime resources, but durable database state remains
  correct across backend absence or replacement.

A short-lived hook/CLI writer must commit the protocol enqueue before exiting. A fire-and-forget microtask after a
state write is not publication: it can lose the notification or reorder two committed states. A topology mutation
and every notification it requires must use the same adopter database and commit in one synchronous transaction.
The runtime may sweep committed pending messages after lost wake hints, but it does not reconcile two authorities:
there is no outbox, keyed topology replay, observer bridge, or cross-database fallback in v1.

Runtime binding is not protocol state. A runtime must resolve and validate its own binding before dequeue; a missing or
stale binding is a runtime condition, not a reason to add claim/ack states to the protocol.

An adopter that cannot be expressed by this list exposes one of two design defects. A shared database transaction
or recovery need means the protocol is incomplete. A need for product state or a native effect means that adopter's
runtime, topology, or adapter boundary is incomplete. It is not a reason to add an adopter id or callback to the
protocol.

## Migration order

1. The pure protocol operations, schema, migrations, and conformance fixtures now live under
   `@spexcode/session-protocol`; the retired `@spexcode/session-core` package has no production edge and is not
   a compatibility export. New callers must use the split package stack rather than restoring that name.
2. Prove self-launch and ZSwarm adopters against the installed package. They exercise recordless/offline and
   multi-workspace/runtime-injected shapes without Spex governance.
3. Keep relation resolution in `@spexcode/session-topology` and lifecycle/event publication in
   `@spexcode/session-application`, in the same database transaction as protocol enqueue. Replace callback drain
   with the runtime's own dequeue/handler loop.
4. The old mixed `runtime-session` bridge is no longer a public entry. New consumers use the split package stack;
   migration input is handled once by the application migrator and never by a runtime fallback.
