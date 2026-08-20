---
title: session-platform-m1-production
status: active
hue: 32
desc: The production-implementation ledger for the first construction stage — milestone alignment, the closing assumptions for open engine details, exclusive lane ownership, and the gates run on the merged tree.
code:
  - docs/session-platform-m1-production.md
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/m2-integration/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
---
# session-platform-m1-production

This node owns the record of turning the frozen session-platform contract into product code. It is a construction
ledger, not a third contract: every operation, error code, byte encoding, and transaction rule it builds against is
owned above it, and nothing here may widen them.

Its first duty is to say which milestone numbering it is speaking. The construction roadmap owns scheduling, and
under that numbering the contract freeze is already delivered as documents and spec nodes. This ledger covers the
production stage that follows: the SQLite protocol core, the neutral topology composition seam, and the thinnest
self-launch adopter with an installed proof. Naming that alignment explicitly is the point — a stage that calls
itself by a number the schedule already used is how a frozen decision gets reopened by accident.

The ledger records the closing assumption for each detail the contract deliberately left open, together with the
reason that assumption is small and reversible. A closing assumption is not a new decision: it names the smallest
choice that lets construction proceed, states what it would cost to reverse, and refuses to widen the schema, the
public vocabulary, or the roadmap while doing so. Where a lower document's wording was derived from a superseded
experiment, the ledger records the correction and which frozen rule outranks it, rather than implementing both.

Construction adds nothing to the legacy path. The new packages have no production importer in this stage, because
the adopters that will import them are later cutovers with their own sabotage and deletion gates. A stage that
quietly wired the new implementation beside the old one would have created the second authority this whole refactor
exists to remove, and it would have spent the deletion gate's evidence before that gate ran.

Ownership is exclusive and serialized where capability depends on capability. Each lane holds a file surface no
other lane writes, the schema-providing lane lands before the lanes that compose on it, and the integrating session
writes only the shared configuration, this ledger, and the merge itself. The integrator re-runs every gate against
the merged tree and never accepts a lane's own report of it, because a result that cannot be reproduced after the
merge has not landed.

The evidence standard is inherited unchanged: a first failure must be the vector's own assertion rather than an
environment error that would fail identically against a correct implementation, original failure output is
immutable, and a counting gate distinguishes a measured zero from a surface that was never measured.
