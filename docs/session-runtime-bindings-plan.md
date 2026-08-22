# Session runtime bindings plan

This plan turns the approved architecture decision into the smallest shared implementation. It is not a protocol
extension: the table is installed by an adopter in its own database and the protocol only supplies the transaction
capability and exact address checks.

## Problem

`session_id` is a durable communication address. A Claude/Codex/ZSwarm runtime identity is a replaceable execution
instance. The current contracts deliberately keep those identities separate, but they do not yet provide a common,
queryable binding primitive. Adopters should not solve this with a free-form field on `protocol_sessions`.

## Target shape

```text
session_runtime_bindings
  namespace + protocol_session_id  PRIMARY KEY
  runtime_kind                     opaque non-empty text
  native_session_id                opaque non-empty text
  native_start_token               opaque non-empty text
  binding_generation               monotonic integer
  status                           bound | unbound
  metadata_json                    bounded JSON annotations
```

`namespace` lets Spex and ZSwarm use the same component without sharing product semantics. The component owns neither
the namespace vocabulary nor the meaning of a native identity. Every bind/unbind uses an expected generation, so an old
runtime cannot overwrite a binding established by a newer runtime. Unbind leaves the row and protocol mailbox intact.

## API boundary

```ts
openRuntimeBindings(protocol)

bindings.bind(tx, sessionId, identity, { expectedGeneration })
bindings.unbind(tx, sessionId, { expectedGeneration })
bindings.resolve(sessionId, tx?)
```

The application/runtime layer calls `resolve` and validates adapter readiness before `dequeue`. The binding component
does not launch processes, inspect liveness, resolve topology, interpret events, acknowledge messages, or requeue a
dequeued message.

## Implementation order

1. Ship the component migration and typed API beside the protocol package; keep the protocol schema unchanged.
2. Add fail-first tests for unknown/retired addresses, stale generations, namespace separation, unbind preservation,
   bounded JSON, and rebind fencing.
3. Run a clean installed-consumer YATU with one fake native runtime identity and the real protocol package.
4. Integrate the binding into Spex runtime first, then prove the same component shape in ZSwarm. Do not add adopter
   fields to the protocol or make topology responsible for native identity.
