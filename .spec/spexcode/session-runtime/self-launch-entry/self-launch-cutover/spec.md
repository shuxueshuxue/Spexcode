---
title: self-launch-cutover
status: active
hue: 280
desc: The construction ledger for the self-launch adopter cutover — what it adopts, what it inventories, what survives sabotage, and which deletion targets are real at this base.
code:
  - docs/session-platform-m4-self-launch-cutover.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/concept-map/m1-production/spec.md
  - .spec/spexcode/session-protocol/concept-map/legacy-deletion-gate/spec.md
---
# self-launch-cutover

This node owns the record of turning self-launch from a harness that merely runs under materialized hooks into an
adopter with a complete, backend-free message loop. The loop is fixed: adopt the new path, inventory what the old
one owned, prove the new path with the old facilities sabotaged, and delete what was actually replaced.

The fourth step has to be settled before construction rather than after it, and by measurement rather than by
wording. [[construction-roadmap]] defines the removal set; applied here it is empty, and the emptiness is the
claim this node must defend. Self-launch never had a message facility to cut over from, because the governed send
path refuses a session with no record, and the facilities it does consume — a storage root derived from the
repository, the materialized manifest, and the sentinels the retained governance hooks write — are ones this
milestone replaces nothing of.

So the removal set is empty, and the gate closes on that measurement instead of being excused by it. What makes the
measurement worth trusting is that it can fail: an inventory classifying every candidate against source, static
references at zero, and a kernel file-access trace attributed through the full process subtree whose calibration
proves it can see the syscall class it counts. The milestone therefore reports one status, not a completion and an
incompleteness at once.

Both neighbouring errors are named so neither is repeated. Counting a dependency that never existed as one that was
removed hands the final audit a false ledger. Removing a consumed facility this milestone has not replaced breaks a
live path in a milestone that owns neither its consumer nor its replacement. Every consumed-but-unreplaced row is
therefore recorded with the later milestone that owns it, so an honest empty set is never read as permission.

Adoption reuses the delivery mechanism the product already has. A materialized hook is a spec node plus one
co-located script, compiled into a per-tree manifest that the shell dispatcher reads; a listener built any other
way would be a second delivery authority for the same concern. The listener runs on the harness's own events,
queries durable state once, hands what it took to the harness input seam, and exits. It is not a daemon, not an
observer, and no wake hint owns correctness: losing every hint delays a message, it never loses one.

The direction of dependency is part of the contract. Making the product CLI import the protocol stack would be the
governed adopter's cutover, not this one, so the listener resolves its adopter command at runtime through one
explicit seam. When a project has configured a protocol database and that seam is broken, the listener fails loudly
with the repair entrypoint. When a project has configured nothing, the listener is inert — that is not a fallback,
because no second path is being tried; it is the absence of a request.
