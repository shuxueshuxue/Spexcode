---
title: session-platform-construction-roadmap-review
status: active
hue: 32
desc: The governed build, session-assignment, adversarial cutover, and independent review plan for the proposed session platform.
code:
  - docs/session-platform-construction-roadmap.html
related:
  - .spec/spexcode/session-protocol/concept-map/spec.md
  - .spec/spexcode/session-protocol/concept-map/platform-architecture/spec.md
  - .spec/spexcode/session-protocol/concept-map/session-management-refactor/spec.md
  - .spec/spexcode/session-protocol/spec.md
  - .spec/spexcode/session-topology/spec.md
  - .spec/spexcode/session-runtime/spec.md
---
# session-platform-construction-roadmap-review

This node owns the linked HTML control plan for building the proposed session platform. The plan turns architecture
into reviewable semantic milestones, assigns each milestone to non-overlapping writer sessions, and requires an
independent adversarial reviewer and product-level evaluator before the integration session may land it.

The unit of progress is an adopter cutover, not a new implementation beside a legacy path. Each cutover must prove
the new adopter through its public surface, name every facility it makes unnecessary, make those facilities absent
or hostile during a sabotage run, and physically remove their code, files, locks, observers, configuration aliases,
and compatibility branches in the same governed milestone. A milestone is incomplete while runtime dual-read,
dual-write, fallback, or a permanent translation adapter remains.

A facility enters a milestone's removal set only when both conditions hold: this adopter consumes it, and this
milestone's new path already replaces its behaviour. Every facility that enters must be removed. A measured-empty
removal set closes the same gate rather than excusing it, and it closes only on falsifiable evidence — an inventory
that classifies each candidate with source-backed citations, and a kernel file-access trace whose calibration proves
it can see the syscall class it counts. Zero removals is then a measurement, not a skipped step, and the milestone
says so in one voice instead of reporting completion and incompleteness at once.

The distinction matters because the two failure modes are opposite. Counting a dependency that never existed as one
that was removed hands the final audit a false ledger. Deleting a consumed facility this milestone has not replaced
breaks a live path in a milestone that owns neither its consumer nor its replacement. So a consumed facility that
this milestone does not replace is named and assigned to the milestone that owns it, and is left standing here.

The plan must show the dependency graph, maximum safe concurrency, ownership boundaries, checkpoint commits,
review handoffs, YATU evidence, merge gates, rollback points, and the exact final demolition gate. Necessary legacy
data conversion is a bounded one-way migration with explicit preconditions and verification; it is never imported
by the normal runtime. The roadmap remains a review proposal until its milestone contracts are accepted into their
owning protocol, topology, runtime, packaging, and adopter specs.

Its milestone numbering is the scheduling authority for this campaign. The implementation-order numbering on the
refactor view is local to that page, the two were once read as a single scheme, and the plan must therefore point at
the crosswalk between them and win wherever they disagree. The engine milestone additionally carries the storage
decisions that are now settled rather than open — the built-in synchronous driver, the rollback journal with its
asserted mode and ordered connection settings, the minimum SQLite version derived from the features actually used,
the interpreter floor the fleet already runs, and the adopter's fail-closed locality precondition — and it states its
throughput exit against measurements taken under the journal this version actually uses, keeping the earlier
write-ahead figures only as labelled history.

One correction is structural rather than cosmetic: the importer must exist and be proven before the cutover that
removes the legacy readers it reads through, so the plan may not order a demolition ahead of the conversion that
depends on it. Every frozen decision the plan records is expected to carry a counter-example that fires when the
decision is reversed; a decision supported only by measurement, with nothing that fails when it is flipped, is an
assertion rather than a gate and must be recorded as such.
