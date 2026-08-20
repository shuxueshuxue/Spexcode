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
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-topology/spec.md
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

The audit reads the architecture the review set describes, not only the documents that describe it. Those are two
different questions, and the second one needs a different admissibility rule: a document can be judged against its
own text, while an architectural element can only be judged against what exists. So every architectural claim is
labelled by the kind of thing it rests on, distinguishing code that runs at the reviewed head from a frozen contract
that has no implementation yet and from a spike proof that is executable but not on the product path. Reading a
planned facility as an existing one is how a subtraction pass invents redundancy that nobody can find, and it
inverts the finding: an element that does not exist yet cannot be over-built, only over-specified.

An architectural finding names the user-observable semantic that breaks when the element is deleted. Where nothing
breaks, the entry says so and carries the proof of absence — that no caller reaches it — because "no consequence"
is the strongest form of a redundancy claim and therefore the one that must be evidenced, not assumed. This is
what keeps an architecture audit from degenerating into a preference for fewer parts.

Duplication is judged against who writes a fact, not against how many places mention it. The audit therefore
establishes the single writer of each piece of state before it proposes any merge, because two readers of one
authority are not duplication while two writers are, and the difference is invisible in a file listing. Two
mechanisms that look interchangeable stay separate when each one holds a distinct cross-process or recovery
guarantee; where a comment already records the failure that produced the split, that record is evidence and the
merge proposal fails on it.

The audit does not restate a duplication that an existing deletion gate already names. Its contribution there is
the residue a passing gate would leave behind — state that the gate's own selectors do not reach — and the areas
where a suspicion of duplication turns out not to survive contact with the tree. Both outcomes are results: a
cleared area tells a later reader that the surface was examined rather than skipped.

Where the material's own evidence discipline forbids rewriting a file, a finding whose proposal would rename or
overwrite an original record is not the smallest fix but a different defect. Adding a record is not automatically
the answer either: before proposing to write a fact down, the audit checks whether that fact is already recorded
somewhere the material already maintains, because a further copy of an already-recorded fact is precisely the
defect this audit exists to find. When the fact is already held, the smallest fix subtracts the unreferenced copy
rather than adding a better one, and the entry says which existing record carries the fact and who owns the file
being retracted. An audit that proposes an addition where a subtraction was available has failed its own standard,
so a corrected proposal is recorded as a correction rather than quietly replaced.

A proposal may branch on how an owner will read a rule, but the branch closes the moment that owner reads it.
Leaving a settled question written as still open is the same defect as a ledger entry recording work that has
already landed, and an audit that judges that defect in its material cannot carry it in its own table. So a decided
proposal is rewritten to the decided path, the examined-and-rejected alternative stays visible with the reason it
lost, and the correction is recorded as a correction.

Each proposal names the owner who can act on it, because a finding filed against the wrong owner cannot be acted on
and reads as unowned work. Ownership follows the file the fix touches, not the lane that found the defect: a gap in
a deletion gate's coverage belongs to that gate's owner even when an unrelated audit proved it, and an evidence
directory belongs to whoever maintains that evidence. The audit itself never takes the fix.
