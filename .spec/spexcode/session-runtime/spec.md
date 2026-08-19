---
title: session-runtime
status: active
hue: 280
desc: The adopter-owned composition loop that combines protocol, optional topology, and one harness runtime adapter while setup remains orthogonal.
---
# session-runtime

A session runtime is a consumer composition, not a daemon required by [[session-protocol]]. It may be a long-lived
Spex backend, a ZSwarm worker loop, or a short-lived self-launch listener. Its minimal loop is always the same:

1. open the protocol for one explicit canonical project root, obtain one exact session id, and initialize its
   protocol address;
2. optionally use [[session-topology]] to resolve related recipients;
3. enqueue complete messages for those addresses;
4. dequeue the local address;
5. pass each returned message to the selected harness runtime adapter.

The runtime adapter owns native effects such as launch, ordinary input, interrupt, stop, liveness, and native
identity. It may keep a handler journal keyed by protocol `messageId` when its own input seam needs retry or
exactly-once handling. The protocol does not call the adapter and the adapter does not edit protocol files.

Harness configuration is a separate materialization adapter. It owns discovered contract files, hook bindings,
trust, skills, commands, and other setup artifacts. One harness registry row may implement both runtime and
materialization facets, but neither facet calls or imports the other. A self-launched harness may therefore use
materialization plus a small protocol listener without importing the Spex managed runtime; ZSwarm may use its
runtime facet without adopting Spex materialization; Spex governed launch composes both.

The three reference compositions are:

- **ZSwarm:** `session-protocol + ZSwarm topology + ZSwarm runtime adapter`. ZSwarm state remains a versioned
  message body or its own record, never a Spex lifecycle field required by the protocol. Its existing injected
  mailbox port can implement dequeue directly; a multi-workspace app-server opens one protocol instance per
  project instead of mutating process cwd.
- **self-launch:** `materialize + session-protocol + explicit listener + harness runtime adapter`. There is no
  `session.json`, board row, parent, resident backend, or automatic drain requirement.
- **Spex governed:** `session-protocol + Spex topology policy + Spex lifecycle/governance + harness runtime adapter
  + materialize`. Its backend improves latency and owns runtime resources, but durable delivery remains correct
  across backend absence or replacement.

A short-lived hook/CLI writer must commit the protocol enqueue before exiting. A fire-and-forget microtask after a
state write is not publication: it can lose the notification or reorder two committed states. If topology mutation
and enqueue are one adopter transaction, they commit together; otherwise the adopter must define the ordering
explicitly. The runtime reconciles keyed topology revisions and protocol messages on startup and bounded sweeps; no
observer bridges that transaction.

An adopter that cannot be expressed by this list exposes one of two design defects. A shared file/lock/recovery
need means the protocol is incomplete. A need for product state or a native effect means that adopter's runtime,
topology, or adapter boundary is incomplete. It is not a reason to add an adopter id or callback to the protocol.

## Migration order

1. Publish the pure protocol operations and message history under `@spexcode/session-protocol`; switch callers in
   one cutover and delete the old `@spexcode/session-core` package instead of adding a compatibility re-export.
2. Prove self-launch and ZSwarm adopters against the installed package. They exercise recordless/offline and
   multi-workspace/runtime-injected shapes without Spex governance.
3. Extract the relation model and migrate Spex governed notification publication to one adopter transaction plus
   protocol enqueue. Replace callback drain with the Spex runtime's own dequeue/handler loop.
4. Remove the public `runtime-session` bridge once installed adopter and Spex lifecycle proofs pass on the same
   fixed protocol; no compatibility package remains.
