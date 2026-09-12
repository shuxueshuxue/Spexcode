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
---
# self-launch-cutover

This node owns the record of turning self-launch from a harness that merely runs under materialized hooks into an
adopter with a complete, backend-free message loop. The loop is fixed: adopt the new path, inventory what the old
one owned, prove the new path with the old facilities sabotaged, and delete what was actually replaced.

The fourth step has to be settled before construction rather than after it, and by measurement rather than by
wording. The adopter cutover contract defines the removal set; applied here it is empty, and the emptiness is the
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

Adoption reused the delivery mechanism the product already had. A materialized hook is a spec node plus one
co-located script, compiled into a per-tree manifest that the shell dispatcher reads; a listener built any other
way would have been a second delivery authority for the same concern. At this milestone's base the listener ran on
the harness's own events, queried durable state once, handed what it took to the harness input seam, and exited —
not a daemon, not an observer, with no wake hint owning correctness. That delivery leg was later removed by decision
(receipt became the recipient's own act, [[inbox]]), and the adopter CLI the listener called was retired when the
governed cutover made the product CLI open the same store; what survives of this milestone's adoption is the
`SessionStart` registration hook ([[session-listen]]) and the shape it fixed — one hook, one address, no resident
process. The ledger this node owns describes the listener as it stood at its base; [[governed-cutover]] records the
change and its proof.

The direction of dependency was part of the contract at this base. Making the product CLI import the protocol stack
would have been the governed adopter's cutover, not this one, so the listener resolved its adopter command at runtime
through one explicit seam, failed loudly with the repair entrypoint where a project had configured a database and the
seam was broken, and stayed inert where nothing was configured — not a fallback, because no second path was tried,
but the absence of a request. That boundary dissolved with the governed cutover, which is why the seam and the
package behind it are gone.
