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

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T05:36:28.473Z -->
Spec: eval-core, eval-proactive, spec-lint

Read-only evidence-surface audit: do not infer a result surface from blobKind alone; a fresh data reading can contain valid Chromium/Playwright evidence (graph-delta is the counterexample). Compare the scenario claim to the measurement method and artifact content instead.

Confirmed fresh false-green candidates for UI remeasurement:
- session-label/one-name-everywhere declares frontend-e2e and requires session row, @ menu, and Rename dialog, but its fresh transcript records only nine sessionLabel unit tests.
- remark-polish/dangling-orphan-visible declares frontend-e2e and visible NodeView dangling content, but its fresh pass says scratch-repo CLI with no browser evidence.
- reconnect/reopen-backoff-reset-and-intentional-close and heartbeat-detects-silent-half-open declare frontend-e2e, while their eval method explicitly runs fake WebSocket/timer logic headlessly without browser/network; current fresh data blobs are absent.

These are evidence-layer-below-claimed-surface drift, not proof that data or transcript readings are invalid. Keep their low-level coverage, lower their UI closure status, and remeasure on a real browser lane. Stale UI scenarios are separately queued; no freshness, gate, or evidence schema behavior changed. Source: read-only audit by @fbb76f84-7a73-4262-81d6-9028f5eb7c4e.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T05:46:24.751Z -->
Spec: eval-core, eval-proactive, spec-lint

Evidence-layer rule refinement from the active zswarm UI false-green investigation: same-surface evidence is an acceptance rule, not a ban on lower-layer diagnosis. Store/CLI inspection may identify the UI projection candidate and payload shape; only a settled real UI observation may close a UI claim.

The first attempted repair failed in real UI after verifying fresh build output: the Swarm payload carries async_launched under workers[], while subagent-session-query reads top-level output.status. Undefined falls through to parent-tool completed and falsely renders success. Because one Swarm part may represent multiple workers with distinct outcomes, copying one top-level status may only stop a symptom; the next diagnostic question is whether each failed child has a distinct part or must be selected by agentId/childSessionId from workers[]. No acceptance claim or source change follows from this diagnosis. Source: @59234d18-3c3a-4632-bbcf-845685a8ea54.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T06:14:51.079Z -->
Spec: eval-core, eval-proactive, spec-lint

Campaign checkpoint at main 5bf4d5400:

- Coverage holes are now closed without source changes: doctor, issues-cli, loop-in, reply-thread, and files/html-previews-rendered-in-a-script-free-frame all have declared, measured records. Full eval lint is 135 flagged: 595 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. Full spec lint is 0 errors and 63 warnings; the remaining code warnings are checkpoints, not automatic ACKs.
- The files frontend-e2e proof is same-surface Chromium evidence through the public UI: Rendered HTML in a sandboxed iframe, frame and parent script sentinels remain null, actions render, and download is proof.html. Normal Chromium hit the public gateway self-signed certificate (ERR_CERT_AUTHORITY_INVALID), so the pass explicitly used ignoreHTTPSErrors=true and retains that access risk plus a non-scenario /projects 401. No local server or source behavior was changed.
- Doctor coverage deliberately records a real failure: an adopted repository before its first commit makes bare spex doctor exit 1 because the history index asks for HEAD; unchanged git status, three synced-main reproductions, transcript evidence, and issue bare-doctor-fails-before-the-first-project-commi. No source patch or narrowed precondition was made.
- Read-only hotspot triage used full global eval inventory, not --changed: harness-adapter 137 stale/44 scenarios, live-view 194/16, state 109/21, session-console 406/25. Their current spec anchors have no post-anchor implementation delta; the dominant debt is inherited whole-file axes and old readings. State also has a genuine historical fail that must remain visible. Next move is narrow explicit function/runner axes plus same-surface remeasurement, not bulk ACK or drift-standard change.
- The zswarm UI incident remains an acceptance-layer finding: after 2a, schema reads stopped failing and the persistent tree loaded, but failure-worker stayed Completed. 2b-0 found the third path: persistent item starts waiting, then SubagentDirectorySidePane.tsx:119-121 unconditionally overwrites worker outcome with conversation projection completedSuccess. Worker outcome and conversation lifecycle are different dimensions. Diagnostic store traces are allowed to locate this path; only real UI may close the fix. No protocol field or drift rule was invented.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T06:28:52.743Z -->
Spec: eval-core, eval-proactive, spec-lint

Checkpoint after state axis pilot at main 24a29d18f: full spec lint is 0 errors / 65 warnings; full eval lint is 135 flagged (596 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned). The count movement since the prior checkpoint comes from concurrent main integration, not a bulk acknowledgement or a standard change.

The pilot narrowed state/explicit-stop-is-authoritative-offline from inherited stop-gate.sh to its actual transition owner spec-cli/src/sessions.ts#stopSessionUnlocked. Same-surface isolated fake-claude + tmux + public spex session CLI reproduced the loss on the synced head: first stop moves online to offline; second stop exits 0 and confirms stopped even though it creates no new transition; resume returns online; close then show is loud. The fail is retained in three readings. This proves the selector repair is honest and the behavior bug remains; no source fix, no precondition rewrite, and no ACK was made.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T07:21:49.618Z -->
Spec: eval-core, eval-proactive, spec-lint

Current checkpoint at main 3aa446108: full spec lint = 0 errors / 64 warnings. Full eval lint = 136 flagged: 599 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. Coverage and missing are genuinely closed; the stale count is not represented as green and moves with concurrent main integration plus more precise scenario axes.

Landed ownership/evidence work:
- lock-hint is now an independent graph/lock-hint leaf owning only lockHint.js. Real Chromium proof uses a real graph base and one declared controlled session/overlay through the graph seam, then actual row-click lock, visible keycaps, release, and cleared banner. keyboard-nav remains narrowly keymap ownership.
- session-console/lifecycle-confirm-owns-enter now names the complete top-level UI closure: SessionInterface capture guard, Modal focus-overlay marker, SessionSelectBar bulk confirmation, and SessionContextMenu row confirmation. A synced isolated backend+Vite+Chromium run verified focus/Enter/one-POST cases; polling bypassed host inotify exhaustion only and was documented as environment setup.

Honest blockers/issues:
- live-view resize compositor is not remeasured yet: real video+WS showed the final grid, while an xterm DOM-text oracle made an observation false-fail. Issue live-view-resize-evidence-runner-treats-xterm-do names the frame/pixel runner repair; no reading was filed.
- harness ask-note remains in harness-adapter but cannot receive an honest narrow anchor until the top-level CLI ask branch has a named handler. Issue harness-ask-note-conformance-has-no-honest-narro records this; no incomplete code axis/readout was filed.

Next work order: repair the live-view evidence oracle, then continue one scenario at a time through the inherited whole-file clusters. Keep state and doctor fail readings visible until their respective runtime fixes are separately decision-gated and product-remeasured.
