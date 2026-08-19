---
title: session-platform-m2-integration
status: active
hue: 32
desc: The integration checkpoint ledger for the M2 engine freeze and the three adopter cut-in packages.
code:
  - docs/session-platform-m2-integration.md
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/concept-map/legacy-deletion-gate/spec.md
---
# session-platform-m2-integration

This node owns the integration checkpoint record for the M2 implementation-detail freeze and the three adopter
cut-in packages. It records what was integrated, which gates ran, and what each gate returned; the delivered
contracts themselves live in their own owning nodes and are not restated here.

An integration record is worth exactly the independence of its gates. Every gate is executed by the integrating
session against the merged tree and is never accepted from a lane's own report: ancestor and file-overlap checks
before merging, then narrow diff, spec lint, byte-level re-comparison of every immutable evidence anchor, and the
real engine and adopter proofs after merging. A lane that reports a result it cannot reproduce on the merged tree
has not landed.

Original failure evidence is immutable. It is never edited, deleted, or overwritten by a later retry, even when it
records a harness defect rather than a contract failure, because the recorded stderr and exit code are themselves
part of the chain. A fail-first record must additionally be discriminating: the failure has to be the vector's own
assertion, since an environment error such as a missing module fails identically against a correct implementation
and therefore proves nothing about the contract. A counting gate must distinguish a measured zero from an
unmeasured surface and must refuse rather than render absence as zero.

The consumer handler journal sits outside the protocol and outside the `dequeue` transaction. The same-database
atomic seam covers topology mutation plus required enqueue only, so `dequeue` remains the at-most-once delivery
boundary. An adapter that needs downstream retry keeps its own `messageId`-keyed journal, which may share the
adopter database but is adopter property: it may never be described as protocol-level at-least-once, and its crash
and retry semantics are the adopter's to prove. Losing the record that handling was owed, when a consumer dies
between the dequeue commit and its own journal write, is a named cost of this version rather than an oversight, and
a crash fixture holds that boundary in place so the absent guarantee stays measured rather than assumed.

The ledger also carries the decisions this checkpoint froze, the two eras of measurement that the rollback-journal
ruling created, the document defects deliberately left unrepaired, and the open items with the evidence each still
needs. A superseded instruction is marked as superseded rather than silently dropped, so a later reader cannot
mistake a reversed one for current guidance.
