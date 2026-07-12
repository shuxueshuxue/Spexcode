---
scenarios:
  - name: adopter-02x-chain
    description: >
      Run rehearsal.sh (co-located): it rebuilds a REAL 0.2.x adopter repo from this repo's own
      history (git archive of the v0.2.8 tag-commit, git init + commit, HOME redirected into the rig),
      runs the new CLI on it un-migrated (materialize, spec lint, eval lint), then runs
      `spex doctor --migrate` once and re-runs the whole chain — including a live execution of the
      migrated stop-gate.sh against a governed active session record.
    expected: >
      One `spex doctor --migrate` run brings the 0.2.x tree to a fully working 0.3.0 state:
      `spex spec lint` reports ZERO errors in the migration-owned classes (integrity / one-govern /
      living — the classes a botched rewrite or git-mv would trip); errors from the post-0.2.8
      content rules (id-format / mention, landed 2026-07-12) are permitted ONLY on the archive's own
      pre-existing content (its leaf-id collisions and the mention resolution they break) — those
      are the adopter's documented post-migration cleanup TODO (deploy runbook step: "clear any lint
      errors the new rules surface"), not migration damage. `spex eval lint` reports 0 malformed
      with the pre-migration readings visible again (no false eval-coverage gaps on nodes that had
      yatsu.md measurements), `spex materialize` succeeds, and the migrated stop-gate.sh — invoked
      through the real hook protocol with the new `spex internal` verbs — blocks an undeclared
      governed stop with the decision:block JSON. Un-migrated, the same chain must fail LOUDLY
      (materialize refuses, naming `spex doctor --migrate`), never silently.
    tags: [cli]
    test: .spec/spexcode/spec-cli/footprint/doctor/migrate/rehearsal.sh
  - name: customized-asset-flagged
    description: >
      rehearsal.sh phase 2: build the same 0.2.x adopter but hand-edit one line of
      .config/core/stop-gate/stop-gate.sh before committing, then run `spex doctor --migrate`.
    expected: >
      The customized stop-gate.sh is FLAGGED for review ("differs from EVERY known stock template
      version") and left byte-identical — the hand edit survives; the migrator never silently
      rewrites an asset it cannot hash-match to a known stock version.
    tags: [cli]
    test: .spec/spexcode/spec-cli/footprint/doctor/migrate/rehearsal.sh
  - name: idempotent-refusal
    description: >
      rehearsal.sh phase 3: run `spex doctor --migrate` a second time on the already-migrated
      adopter repo.
    expected: >
      The second run REFUSES cleanly before any write — exit non-zero, "already migrated" named in
      the refusal, tree unchanged.
    tags: [cli]
    test: .spec/spexcode/spec-cli/footprint/doctor/migrate/rehearsal.sh
---
Measured YATU through the shipped CLI (`spex doctor --migrate` and the post-checks are the real product
surface an adopter operator runs), never by reasoning about the rewrite tables. The rig is
deterministic — the 0.2.8 tree comes from this repo's own immutable history — so a reading is
reproducible from any checkout: `bash rehearsal.sh`.
