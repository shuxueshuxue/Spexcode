---
title: governed-cutover
status: active
hue: 280
desc: The construction ledger for the Spex governed adopter cutover — what already ran on one database authority before it was gated, the gates run after the fact, and the self-launch address seam that completes it.
code:
  - docs/session-platform-m6-governed-cutover.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-runtime/application-service/production-cutin/spec.md
  - .spec/spexcode/session-runtime/self-launch-entry/self-launch-cutover/spec.md
  - .spec/spexcode/session-runtime/self-launch-entry/spec.md
  - .spec/spexcode/spec-cli/sessions/comms/inbox/spec.md
---
# governed-cutover

This node owns the record of the governed adopter's move onto one database authority. Its first duty is to state a
landing honestly: the cutover the roadmap called M6 shipped as the production cut-in and a live migration, and has
carried every governed session since, without a ledger of its own. A milestone that ran in production before it was
gated is not undone by that order, but it is not closed by it either. The ledger therefore measures the landing after
the fact — which legacy readers and writers are gone from source and from the live store, which fences were kept on
purpose, which roots survive with no caller — and runs the gates the landing skipped before it calls anything closed.
The negative gate is its own node ([[governed-sabotage]]): the cut facilities planted back and poisoned, the real
product run under a file-syscall tracer, the settled backend required to read none of them. Its first run found a
way one stray unreadable legacy file could take the whole backend down, which is exactly what a gate that had never run
could not have found.

The second duty is direction. Self-launch reaches the message path through the protocol address it already owns, not
through a governed record; giving it a record would make it governed, which the runtime composition forbids. The seam
is therefore three things the product CLI itself provides: a registration that writes only into a store that already
exists and is ready, a producer that accepts a bare address and reports it queued rather than pushed, and receipt as an
act the recipient performs in three shapes that match how a harness can run a command — now, in the background until
one arrives, or as a monitor that never returns. The adopter package that once carried a parallel argv vocabulary for
the same store was retired when this became true, and the storage placement rules it housed moved to the lowest layer
every Spex composition shares.

A proof that no longer runs green is the same as no proof. Two scripts this ledger inherited assert contracts that a
later decision replaced, and neither sits on a path anything executes, so they stayed red unnoticed. The ledger names
them, attributes each to the change that outdated it, and adopts one rule: a proof a ledger cites is either on an
executed path or carries the commit it was last green at.

Facilities kept for a reason are kept by name. An external-effect fence around an adapter handover is not a queue
lock, a root with no caller is residue for the demolition milestone rather than a live dependency, and a hook's own
state directory is governance state rather than message state. Each is classified once, with its callers, so the final
audit inherits categories instead of a list of survivors.
