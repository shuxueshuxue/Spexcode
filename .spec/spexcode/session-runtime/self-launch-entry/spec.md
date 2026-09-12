---
title: self-launch entry
status: active
hue: 280
desc: How a harness a human started themselves joins the session mesh — one registration hook gives it an address, and the ordinary product CLI is both its producer and its receiver.
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/.plugins/core/session-listen/spec.md
  - .spec/spexcode/spec-cli/sessions/comms/inbox/spec.md
---
# self-launch entry

A self-launched session is a harness a person started in their own checkout, under materialized hooks, with no
backend owning its process and no governed record. It joins the mesh with exactly one artifact of its own: the
`SessionStart` registration hook ([[session-listen]]), which asks the product CLI to initialize the harness's native
session id as a protocol address in the project's canonical store. Registration happens only where that store already
exists and is ready — a project with no governed backend has nothing to register into, and the hook must never create
a store to have somewhere to write.

Everything else self-launch needs is the governed product's own surface. Sending to it is `spex session send` with the
bare address ([[dispatch]] accepts an address that has no application row and reports it queued, never pushed).
Receiving is the caller's own act, in three deliberately distinct shapes owned by [[inbox]]: a one-shot `dequeue`, a
blocking `wait-dequeue` meant to be run as a background command whose exit is the wake-up, and a persistent
`stream-dequeue` meant to feed a monitor one line per message. There is no prompt hook that reads mail, no daemon, and
no second CLI: the adopter package that once carried a parallel argv vocabulary was retired when the governed cutover
made the product CLI open the same store.

The two construction ledgers under this node ([[self-launch-cutover]], [[self-launch-inventory]]) are the record of
how this path was measured into existence; they describe the listener as it stood at their base, and the governed
cutover ledger ([[governed-cutover]]) records where that shape changed.
