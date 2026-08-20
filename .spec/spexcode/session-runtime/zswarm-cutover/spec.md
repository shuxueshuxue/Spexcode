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

Removal authority is not the same as removal evidence. The facilities this milestone would retire sit in the
adopter's repository, so this milestone produces the precise kill list and a replacement already shown to work, and
stops there. An integrator that edits another product's source because it can reach the filesystem has confused
access with ownership, and the campaign's own rule against repairing a branch under review is the same rule one
level up.
