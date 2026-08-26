---
scenarios:
  - name: detects-double-delivery
    tags: [cli]
    description: >-
      Drive `spex doctor --conflicts` through the real CLI in a SpexCode-adopted checkout. First run it
      with no plugin bundle present and capture the exit code. Then plant a `spexcode` plugin bundle
      under `.claude/plugins/spexcode/` carrying `.claude-plugin/plugin.json` (`"name":"spexcode"`),
      a `hooks/hooks.json` whose command references `dispatch.sh`, and a `skills/<name>/SKILL.md`
      for one of the materialized skill names — i.e. a second discovery channel alongside the loose
      native delivery. Run `spex doctor --conflicts` again, capture exit code + output, then remove the
      bundle and run once more. File the transcript with
      `spex eval add doctor --scenario detects-double-delivery --result <txt> --pass`.
    expected: >-
      The first (single-channel) run exits 0 and reports "No double-delivery". With the bundle
      planted the run exits NON-ZERO (1) and flags `claude` as DOUBLE-DELIVERY CONFLICT on every
      channel it stamps: delivery sources 2 (loose + the named plugin), hooks→dispatch 2, and the
      skill name shadowed ×2 — codex (no codex bundle) stays single/ok — followed by the three
      repair options (remove the bundle / switch `harnesses` to a plugin target / run `spex uninstall`
      to remove the loose copy). After the bundle is removed the run returns to exit 0. Detection is purely by
      identity stamp (plugin.json name, the dispatch.sh shim, our skill names), never payload.
    code: spec-cli/src/doctor.ts
  - name: read-only-surface
    tags: [cli]
    description: >-
      Drive the real CLI help through both supported help probes (`spex help doctor` and
      `spex doctor --help`), then invoke the retired `--migrate`, `install`, and `uninstall`
      spellings against a clean repo and capture their exit codes, stderr, and git status.
    expected: >-
      Both help probes expose exactly the bare report, `--contract`, and `--conflicts`; no migration
      or staged write appears. `--migrate` exits 2 as a removal signpost naming the 0.3.x bridge release;
      `install` and `uninstall` exit 2 as unknown. All three perform no action and leave the working tree
      byte-for-byte unchanged. Repair remains on `spex materialize`, `spex init`, and `spex uninstall`,
      never a second write path under doctor.
    code: spec-cli/src/doctor.ts
  - name: bare-diagnosis-is-read-only
    tags: [cli]
    description: >-
      In an isolated git repository, adopt a project through the real local `spex init --harness codex`
      with an isolated home, then run bare `spex doctor` through the CLI on PATH. Capture its exit code,
      complete output, and `git status --porcelain` immediately before and after the diagnosis.
    expected: >-
      Bare doctor exits 0, identifies the repository as Spex-adopted, and prints the Spec health diagnosis
      plus Layers 1 through 5, Coverage verdict, and Footprint. The report includes both altitude and breadth
      health rows and the single-channel double-delivery result. The before/after git status is identical:
      diagnosis reads the adopted project without creating, staging, or changing files.
    code:
      - spec-cli/src/doctor.ts#doctor
      - spec-cli/src/doctor.ts#specHealthDiagnosis
      - spec-cli/src/doctor.ts#doubleDeliveryReport
  - name: an-ungoverned-tree-is-distinguishable-from-a-healthy-one
    tags: [cli]
    description: >-
      Adopt a fresh project, then run `spex doctor` against its tree slot four times: healthy; with the
      turn-end lines removed from the manifest but every handler left in place; with the manifest emptied;
      and with the manifest deleted. Read Layer 3's manifest and lifecycle lines each time.
    expected: >-
      Four distinct readings. Healthy names Stop, StopFailure and PostToolUse as bound. Dropping only the
      turn-end lines — every other check still passing — is called out as a tree that cannot report its own
      turn ending, with the consequence named: the board keeps painting a stopped agent as running. An EMPTY
      manifest reads as EMPTY and explicitly not as MISSING, because the dispatcher refuses a missing one
      loudly and dispatches nothing for an empty one in silence. A deleted manifest still reads MISSING.
      Zero loss = the two silences a healthy-looking hook layer can hide each have their own words.
    code: [spec-cli/src/doctor.ts]
    test: spec-cli/src/doctor.test.ts
---
# eval.md — self

`doctor` is measured through the real CLI (YATU). The double-delivery scenario plants a genuine second
discovery channel — a `spexcode` plugin bundle beside the loose native delivery —
and confirms the command catches it by IDENTITY STAMP and exits non-zero, then that removing the bundle
clears it. The loss being watched is the SILENT double-delivery: a marketplace-installed or leftover
`spexcode` plugin doubling hooks and shadowing skills while everything still *looks* governed — the
mirror failure of the under-delivery `doctor` already catches. The read-only-surface scenario proves the
retired write paths are gone rather than merely hidden from one help page. The bare-diagnosis scenario
uses an isolated adopted repository to prove the full report reaches the user-facing CLI and remains
read-only.
