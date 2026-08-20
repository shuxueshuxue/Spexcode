---
title: architecture-simplification-audit
status: active
hue: 196
desc: The subtraction audit over the session platform review set, recording only redundancy that a file and line can prove.
code:
  - docs/architecture-simplification-audit.md
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/platform-architecture/spec.md
  - .spec/spexcode/session-protocol/concept-map/session-management-refactor/spec.md
  - .spec/spexcode/session-protocol/concept-map/construction-roadmap/spec.md
  - .spec/spexcode/session-protocol/concept-map/legacy-deletion-gate/spec.md
  - .spec/spexcode/session-protocol/concept-map/m2-integration/spec.md
  - .spec/spexcode/session-protocol/sqlite-engine/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
---
# architecture-simplification-audit

This node owns the subtraction audit over the session platform review set: the three frozen review pages, the
concept map, the engine contract, the adopter cut-in plan, the deletion gate, the integration ledger, their spec
nodes and their spikes. The audit reads; it does not act. Its findings are proposals addressed to each document's
owner, and the audit never edits the material it reviews, never touches production code, and never rewrites
historical evidence.

An audit entry is admissible only when a file and line prove it. An intuition that some element feels heavy is not
a finding, because a reviewer who lists suspicions transfers the burden of proof onto the owner and makes the list
cheaper to write than to read. Every entry therefore carries the element, its evidence location, the concrete
problem the element solves, the reason it is redundant or must stay, the smallest available subtraction, and the
risk of taking it. Naming the problem an element solves is what keeps the audit honest: an element whose purpose
cannot be stated has not been understood well enough to judge.

The audit proves what cannot be deleted before it proposes deleting anything. At least one counter-example must
look complex and turn out to be load-bearing, and at least one must break semantics if removed, each established
by the same standard of evidence the findings use. This ordering is the audit's own fail-first: a subtraction pass
fails by mistaking apparent complexity for actual redundancy, so the pass demonstrates that it can tell the
difference before its conclusions are worth reading.

Redundancy claims are separated by kind, because the smallest fix differs by kind. A second writable copy of one
fact belongs to whichever document owns that fact. A derived value restated away from the table it comes from is
duplicate state, and a restatement that disagrees with its source is that duplication already having failed. A
justification that survives a reversed decision is residue even when its conclusion still holds, because the
argument now points at a facility the frozen design does not have. A ledger entry recording work that has since
landed is the same defect in the opposite direction: an obsolete middle state written as current truth, which
costs a reader the same wasted execution as a missing entry costs.

A ledger of pending work is audited against the tree, not against itself. Whether an item is still open is decided
by reading the target at the reviewed head and, where useful, the commit that closed it — never by trusting the
ledger's own status. This is why several documents can each describe correct intent and still, together, misstate
what remains to be done.

Overlap alone does not establish redundancy. Several ledgers may carry the same identifiers while recording
different columns of fact about them, and there the correct subtraction is one column rather than one table. A
finding that would collapse distinct facts into a single surface is rejected, and so is one whose merge would drop
a scope qualifier that only the duplicate carries; where such a qualifier exists, the audit says where it must
move before the duplicate can go. Verification surfaces get the same treatment: independent counts that measure
different surfaces stay independent, because a baseline where they diverge is proof that collapsing them would let
one surface stand in for the rest.

The audit records where its own instruments came from, held to the standard of evidence it demands of its findings.
A reader who cannot tell which review lenses were applied, at which version, cannot tell a clean surface from an
unexamined one. So the provenance names each instrument's resolved location and version and the command that shows
them, and where an instrument was read but deliberately not followed as written, it names the deviation and the
rule that required it. An instrument installed by other than its recommended path says which path it took and why:
the real failure output when one was observed, and, when the recommended path was never reachable from this
environment, that fact stated plainly rather than a failure the audit did not witness.
