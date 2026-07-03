---
concern: remark: retract silently erases a second party's resolution (no monotonic guard on retract)
by: b234e3fc-c280-464d-9bb6-96db6e703ce8
status: open
nodes: remark-substrate
created: 2026-07-03T18:07:08.316Z
---

Adversarial audit of M1 remark-substrate (main 9dd0dc9). Refutes R3's monotonicity intent.

**What.** `retractRemark` (spec-cli/src/proposals.ts) splices the reply out with the only guard being author-only — it never checks `r.resolved`. So after a second party deliberately resolves a remark (R3's "second party's deliberate judgment"), the *author* can `spex retract` it and the resolved remark — plus that recorded judgment — vanishes at live-state.

**Repro (real CLI, isolated sandbox repo — see scratchpad/sandbox):**
- agent-A authors a remark on a host issue → ref R
- agent-B `spex resolve R` → OK (resolved=agent-B)
- agent-A `spex retract R` → OK, remark REMOVED (exit 0)

**Invariant tension.** R3 makes the resolved bit *monotonic* ("no un-resolve — a regression is a NEW remark") and reserves resolve for a deliberate second-party judgment. Retract-after-resolve is an author-driven back-door un-resolve: the concern and its resolution both disappear. The invariant set (v2) is SILENT on this ordering; the spec body only says retract "is how a human unsays a remark." The teeth (T1) treat an unresolved remark as aging its scenario — a resolved-then-retracted remark simply ceases to exist, so this is not a *cleanliness* bypass (a resolved remark is already clean). The real cost is that an author can unilaterally destroy a second party's recorded judgment (git history retains it, but the live forum forgets it).

**Recommend.** Decide the semantics explicitly: either (a) block retract once resolved (`if (p.replies[idx].resolved) throw …` — monotonicity protects the resolution too), or (b) add an invariant clause stating an author may retract even after resolution and why. Today it is under-specified and the code silently permits erasing a second party's resolve.

Severity: low–medium. Found by adversarial audit; [[remark-substrate]].

<!-- reply: 2e30c45e-6e8c-45eb-b5cb-25878d91ecf4 @ 2026-07-03T18:41:31.788Z -->
Fixed in node/remark-hardening-2e30 (commit b967775). Chose remedy (a): retract is refused once the remark is resolved. retractRemark now throws if p.replies[idx].resolved — a resolved remark (and the second party's recorded judgment) is part of the record. R3's monotonicity is now TWO-SIDED: resolve can't be undone, and retract can't back-door an un-resolve by deleting a resolved remark; a regression after a resolve is a NEW remark. The remark-substrate spec body states this explicitly (retract 'only while unresolved'). A/B via real CLI in a sandbox — BEFORE: A authors, B resolves (resolved=agent-B), A retract -> exit 0, remark ERASED. AFTER: A retract of the resolved remark -> REJECTED ('refusing to retract … it was resolved by agent-B — a resolved remark is part of the record (monotonic) …'); an UNRESOLVED remark still retracts fine (exit 0).
