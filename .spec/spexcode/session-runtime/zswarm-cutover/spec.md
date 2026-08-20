---
title: zswarm-cutover
status: active
hue: 280
desc: The ZSwarm adopter milestone — what its real external runtime consumes today, what the new stack proves in a clean consumer, and where the removal authority actually sits.
code:
  - docs/session-platform-m5-zswarm.md
related:
  - .spec/spexcode/session-runtime/spec.md
  - .spec/spexcode/session-runtime/adopter-cutin/spec.md
  - .spec/spexcode/session-protocol/concept-map/spec.md
---
# zswarm-cutover

This node owns the ZSwarm adopter milestone. Its first duty is to correct the record it inherited: the campaign
recorded that the runtime bridge had no production importer and that external ZSwarm use was unproven. That reading
was true of this repository and false about the world — the importer lives in another repository, declares the
legacy package, and calls every one of the bridge's exports. A ledger that says "unproven" when nobody looked is not
the same as one that says "absent", and the difference is a live external product.

The consequence orders the milestones rather than decorating them. Removing the bridge before that adopter migrates
breaks something real, so the demolition milestone and the audit finding that called this module free to delete are
both blocked here, and say so.

Adoption is proved where the roadmap says it must be: a consumer outside this repository, installing the published
protocol stack, running the adopter's own shape — its own absolute database path, its own relation model, its own
worker loop — with no product runtime available to lean on. That proof belongs to this milestone whether or not the
adopter's own repository has migrated yet, because it establishes that the replacement is sufficient.

Removal authority is not the same as removal evidence. The facilities this milestone retires sit in the adopter's
repository, so the work carries through to a real implementation there — a proposal branch on an isolated working
copy that swaps the legacy dependency for the protocol stack and deletes what it actually replaces — while the
authority to merge stays with that repository's owner, whose own contract reserves design-level changes to them.
An integrator that merges another product's source because it can reach the filesystem has confused access with
ownership. Implementing is not merging, and the milestone closes at the first of those.

Because the adopter installs artifacts this repository builds, the proposal is only meaningful while the two sides
name the same bytes: the packed tarballs carry their SHA-256 and their originating commit in the adopter's own
documentation, so the vendored copies are traceable from the repository that holds them rather than only from here.
Vendoring is transitional and states the condition that ends it; changing where a package installs from must never
become a runtime fallback.

Governance travels with the repository that defines it, not with the change. This repository stamps its commits
with the node and session that justify them; the adopter's repository asks for something else, and its working copy
answers to no session at all. Imposing the stamp there would put an identifier in front of readers who cannot resolve
it, and buying that conformance by rewriting a commit would delete the very object the milestone's readings name as
the state they measured. Evidence outranks format: the provenance chain — session, implementation commit, readings
commit — is recorded on the governing side, where it can be resolved and where the obligation actually sits.

Failures already present in the adopter's tree are not this milestone's to claim or to disown. Attribution is
measured — the same tests, byte-identical between base and proposal, run in independently installed trees, compared
by the identity of the failure set rather than its count — and what that measurement assigns to the base is handed
back named, not silently fixed and not quietly ignored. A reference scan that reaches only direct callers may
corroborate such a conclusion but can never carry it.
