---
concern: global drift remediation: bounded backlog, axis repair, and decision-gated behavior changes
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: eval-core, eval-proactive, spec-lint
created: 2026-08-10T04:26:49.756Z
---

Spec: eval-core, eval-proactive, spec-lint

## Purpose
Coordinate the existing global spec/eval drift backlog from one ledger without redefining freshness, drift, or gates by accident.

## Baseline
At main 72c34680e: spec lint has 0 errors and 76 warnings (74 governed-code drift, 1 uncovered code file, 1 related-drift aggregate). Full eval lint reports 143 flagged nodes: 602 stale scenarios, 1 unmeasured scenario, 5 governed-code nodes without eval.md, and 38 explicit over-owned files. `eval lint --changed` is lane-local only and is never used as this global-health baseline.

## Allowed before a human behavior decision
- Triaging each spec warning into contract update, reasoned Spec-OK ack, or implementation repair.
- Adding a missing spec/eval owner, splitting broad source ownership, making scenario code axes more precise, and running real YATU measurements with evidence.
- Creating independently reviewable campaign reports and issues.

## Decision gate
Before any source change that could alter a drift/freshness criterion, scenario selection, scope/base choice, gate behavior, or the outward meaning of a score: create a self-contained HTML decision log with the live baseline, reproduction, affected contracts, options including no-change, expected blast radius, and verification plan. Publish it through `spex session files add`, then declare asking and wait for the human choice. Do not write that behavioral source change before the decision.

## First work order
1. Surface effective inherited scenario code axes in the diagnostic inventory; do not change stale semantics.
2. Triage the hot nodes (harness-adapter, session-console, state, live-view) before mass remeasurement.
3. Close coverage holes and stale issue records; do not bulk-ack or bulk-file pass readings.
4. Establish a main-head nonblocking ratchet only after its semantics have been through the decision gate.

## Done condition
A reviewable dashboard-visible ledger names every remaining debt class, its owner/campaign, and whether it is blocked on a human decision. No historical `--changed` green result is represented as global freshness.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T04:38:33.943Z -->
Checkpoint after read-only triage (repo-local CLI; integration code 888eeb565, ledger commit 0896fe7e8):

- Current spec lint: 0 errors; 67 governed-code drift warnings, 1 uncovered file (spec-dashboard/src/lockHint.js), and 1 soft related-drift aggregate (388 related files across 119 nodes). The old 74 warning count was from the pre-L0-move snapshot and is not the current baseline.
- Current eval lint: 143 nodes flagged; 602 stale, 1 unmeasured, 5 eval coverage gaps, 38 explicit over-owned files, 0 malformed.
- Axis audit: 786 scenarios = 370 inherited node axes, 573 effective whole-file axes, 173 selector-only, 40 empty. 407 stale readings are code-only with a whole-file effective axis. This is a precision worklist, not evidence that the stale rule is wrong.
- First mapping hotspots: harness-adapter (38 stale / 22 inherited), session-console (25 / 21), state (19 / 17), live-view (16 / 16).
- Spec triage: launch-hero and evidence-get/evidence-put are scoped-unit ACK candidates after their owners verify the named units; zcode-harness and lockHint.js are ownership repairs, not ACKs.

Decision gate status: Decision 001 is posted on @fbb76f84 as a session file. It asks whether eval-owners may report effective inherited axes diagnostically. No source change, freshness criterion, gate, or `--changed` behavior has been modified.

Next non-behavioral work, capacity permitting: define/measure the five coverage gaps; measure files/html-previews-rendered-in-a-script-free-frame through real CLI + Chromium; triage the 105 semantic scenario stales before code-only backlog. Do not mass-ack or mass-file pass readings.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T05:02:30.855Z -->
Coordination correction: Decision 001 is a preserved, dashboard-posted source-change proposal, NOT a blocker for the remediation campaign. It was raised too early because no current work requires changing eval-owners or any drift/freshness/gate semantic. Continue the non-source work order now: coverage declarations, source/spec ownership triage, and real YATU evidence. Re-open the decision only when a concrete source patch is ready to start; publish a fresh log against that then-current main before editing it.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T05:25:02.565Z -->
Evidence-axis pilot landed in 17a2ee4ca. `evidence-get/roundtrip` and `evidence-put/put-idempotent` now name `spec-eval/src/cli.ts#blobGet` and `#blobPut`, matching their scoped node contracts. On ce9ba08b4, a real CLI run in an isolated Git repository re-measured binary path/repeat/stdin put idempotence, cache placement, get -o and stdout-pipe byte equality, empty-input refusal, and unknown-hash local+backend loud failure; readings are 7c1c1a11f. Full eval lint no longer lists either scenario stale. Do not generalize from this pilot into a bulk rewrite: zcode-harness inspection found a real spec/eval scope mismatch, not an ACK candidate. New audit rule: evidence must be taken on the same product surface a scenario claims; CLI/store/localhost evidence can diagnose but cannot close a UI/public-path claim. The motivating UI incident is an in-flight projection-layer false green: on one terminal screen failure-worker reports FAILED(false, exit 1) while the Agent swarm tree shows Completed, confirmed at terminal state rather than timing. Spec: eval-core, eval-proactive, spec-lint
