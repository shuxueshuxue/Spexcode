---
title: session runtime bindings
status: active
hue: 280
desc: The adopter-owned binding between a durable protocol address and the currently attached native runtime identity.
code:
  - docs/session-runtime-bindings-plan.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings-package/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings-schema/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings-errors/spec.md
  - .spec/spexcode/session-runtime/runtime-bindings-yatu/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
---
# session runtime bindings

`session_runtime_bindings` is an adopter-owned component. It binds one durable protocol address to the currently
attached native runtime instance without adding harness, lifecycle, topology, or project fields to the protocol row.
The component may share the adopter's protocol database and its transaction capability, but `session-protocol` does
not read or interpret this table.

## Contract

- `protocol_session_id` is an exact existing protocol address. Binding never creates an address and never resurrects a
  retired one.
- One `(namespace, protocol_session_id)` has at most one current binding. The namespace belongs to the adopter and is
  not interpreted by the component.
- `runtime_kind`, `native_session_id`, and `native_start_token` are opaque non-empty strings. The start token fences
  a reused native id or PID after a runtime restart.
- `binding_generation` increases on every bind or unbind. Updates use an expected generation and fail on a stale
  writer; an old runtime cannot overwrite a newer binding.
- `metadata` is a small adopter-owned JSON object for non-authoritative annotations. Fields that affect correctness
  must be explicit contract fields, not hidden in metadata.
- `unbind` leaves the row as an unbound tombstone with its generation. It does not retire the protocol address and
  does not dequeue or requeue messages.
- `resolve` is a read. A missing binding is an ordinary runtime condition, not a protocol address miss.
- Binding operations run before dequeue. A successful protocol dequeue remains the at-most-once transfer boundary;
  the component does not add acknowledgement, redelivery, or adapter callbacks.

## Ownership and non-responsibilities

The adopter owns the namespace, native identity meaning, binding policy, and any consumer journal. The component does
not launch or stop a harness, inspect a PID, infer liveness, resolve topology, interpret event payloads, or decide
whether a native adapter can accept input. Those checks happen in the runtime/application layer before dequeue.

The table is not an event log and is not a second source of session state. If an adopter needs binding history for
audit or replay, it owns a separate event or audit stream; the current binding row is only the current attachment.

## Schema shape

The initial component migration creates one strict table keyed by `(namespace, protocol_session_id)` with explicit
columns for the binding identity, generation, bind/unbind times, status, and bounded JSON metadata. It uses the
protocol transaction capability and does not expose a raw connection or a second commit authority.

## Required proof

The package must prove: binding an unknown or retired address fails; stale generation updates fail; unbind preserves
the address and pending messages; rebinding after a native restart fences the old token; namespaces do not collide;
metadata is bounded and JSON-only; and the protocol package's public API and schema remain unchanged.
