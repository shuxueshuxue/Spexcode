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

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T09:50:42.856Z -->
Spec: eval-core, eval-proactive, spec-lint

Checkpoint at main 2b927073d: full spec lint is 0 errors / 64 warnings; full eval lint is 136 flagged: 596 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned.

Three same-surface evidence repairs have landed without changing drift, freshness, gate, or score semantics:
- live-view resize now has a durable real Chromium pixel/frame runner with an explicit empty graph fixture and a post-sync fresh frontend-e2e reading;
- session-label one-name-everywhere now proves the real browser list, @ picker, and Rename prefill rather than only unit tests;
- harness ask now has a named declaration handler and a valid settled Codex pass. The earlier pre-settlement Codex reading was explicitly retracted because send receipt proves queue acceptance, not completed execution.

The next bounded item is remark-polish/dangling-orphan-visible: its declared CLI plus browser surface was previously backed only by CLI evidence. It will be remeasured on that declared surface, not acknowledged wholesale. Reconnect remains separately queued because its current fake-WebSocket tests are useful auxiliary coverage but cannot close its browser claim.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T11:50:57.173Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, graph-stream

Current main remeasure after the served-root graph repair: spec lint is 0 errors / 60 warnings; eval lint is 137 flagged nodes, 603 stale readings, 0 malformed, 0 missing, 0 coverage gaps, and 39 over-owned files.

The graph product gap is resolved and its issue is closed: dd813c9d4 carries cde0fb8ed plus a fresh served-project-first-spec-visibility reading. An initially empty served root now observes first .spec creation and deletion through the ordinary canonical root watcher. Ordinary HTTP converged on the merged code without delta SSE or restart; the existing graph-stream readings that share this changed source correctly became stale and remain queued for remeasurement. No drift threshold, freshness policy, gate, score, or scenario executor changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T11:57:32.757Z -->
Spec: graph-stream

Independent integration confirmation from the ZCode consumer line on main descendant 587ad88e2: a new empty Git workspace and a new graph service, ordinary HTTP only and no SSE or restart, warmed at fresh/0 then first .spec appeared in 406ms and deletion returned fresh/0 in 340ms. Three further cycles each created three nodes and removed the entire .spec root; all 12 transitions converged at roughly 326-385ms with no decay. This specifically rules out delta cold patrol and one-shot watcher attachment in the consumer shape that originally exposed the defect.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:06:39.850Z -->
Spec: doctor

Closed the doctor first-commit product failure at e5fa39a5b. The diagnostic now reads only the current spec tree for health rows instead of accidentally requesting history/drift indexing that cannot exist before initial commit. Same disposable real CLI has the recorded fail-to-pass pair, and main post-merge targeted regression passed 14/14 with an unchanged worktree. This lowered the structural spec-warning baseline from 60 to 59; no lint threshold, freshness policy, gate, score, or executor changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:16:51.620Z -->
Spec: zcode-harness, hook-dispatch

Read-only zcode-harness mapping separates a concrete adapter bug from a real ownership decision. Current SpexCode ownership is static settings/hook materialization, prompt launch, liveness, and delivery/resume refusal. The spec also claims app-server RPC observation, V4 hydration, child lineage, direct workspace routing, and native ID correspondence that are upstream ZCode capabilities with no Spex bridge or product scenario today. That runtime bridge remains decision-gated rather than being erased or silently implemented.

Separately, zcode Stop hook delivery is a current implementation bug: generated dispatch.sh zcode Stop is parsed as event zcode because dispatch lacks zcode in its harness case, then exits 0 without a manifest match. Issue zcode-stop-hook-is-generated-but-dispatch-silent tracks the narrow implementation/proof repair. The existing artifact-only scenario is not being called a runtime pass.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:33:06.808Z -->
Spec: zcode-harness, dispatcher-runtime

Closed the concrete ZCode Stop adapter no-op at bd871ed4c. The generated zcode Stop command now uses the existing dispatcher harness-selector path, reaches the selected manifest Stop gate, and has a real generated-command fail-to-pass transcript plus main post-merge 26/26 dispatcher regression. The repair lowered spec warnings from 59 to 57 without touching drift/freshness/gate/score semantics. The larger zcode-runtime-bridge ownership question remains open and explicitly unclaimed; this repair did not add app-server observation or native ID semantics.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:45:58.800Z -->
Spec: graph-stream, drift-by-ancestry

Resolved the zero-commit graph API gap on main `597bfe3ad` (implementation `fa428f979`, then current-state ownership reconciliation `b9c41e74f` and mechanics-only `event-ledger-demand` acknowledgment `d905033f9`). Before the repair, a valid `git init` workspace with unborn `HEAD` returned HTTP 500 because history indexing ran `git ls-tree HEAD`; a one-commit empty workspace returned HTTP 200/nodes=0.

The repair treats a valid unborn branch ref as empty Git history/index input, preserving the unborn sentinel as a cache identity so the first commit takes a new cache path. It does not add an API short-circuit; invalid or malformed Git still fails loudly. Current main regression passed the Git unborn-history case and graph API cases for zero-commit first `.spec` creation plus base-root create/delete.

Independent consumer YATU confirmed ordinary HTTP only, new services, no SSE/restart: zero-commit warm 200/0 -> first `.spec` 364ms/1 -> deletion 377ms/0; one-commit control remained 200/0 -> 369ms/1 -> 342ms/0. The creation leg is intentional: it would fail under the prohibited “return empty for empty repos” shortcut.

Current whole-repo baseline after landing: spec lint 0 errors / 57 warnings; eval lint 138 nodes flagged, 606 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. No freshness, drift threshold, gate, score, or scenario-selection behavior changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T12:52:56.121Z -->
Spec: graph-cache, graph-delta, guidance-catalog, platform-support, session-new-monitor-hint, ls-cjk-width, session-selectors

Narrow spec-warning reconciliation, all on current main and without changing a drift/freshness/gate/score rule:

- graph-cache (`a1ccd60d7`): L0 package extraction only changed the `buildBoard`/`spliceSessions` import path.
- graph-delta (`c745a752d`): removed an in-code navigation comment duplicated by the current delta spec.
- guidance-catalog (`38d0a79ae`): L0 moved the same git/config loaders from `@spexcode/l0` to `@spexcode/spec-core`.
- platform-support (`7f1a1f3e5`): removed a navigation comment duplicated by its current platform boundary.
- session-new-monitor-hint (`dcbcaa70e`): all five declared function selectors were unchanged; public-graph and internal hook-prompt help entries were outside the node scope.
- ls-cjk-width (`4e5ec4830`): test fixtures now use existing derived `title`; the new assertion pins the already-written “not selector label” rule.
- session-selectors (`9537a9693`): its test fixture likewise changed only the retired display field from `label` to `title`; matching grammar is unchanged.

Each is a separately reasoned `Spec-OK` commit, not a bulk ack. Current main baseline: spec lint 0 errors / 49 warnings; full eval lint 137 nodes flagged, 605 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. The remaining warnings are still queued for intent/implementation/structure triage rather than automatic acknowledgment.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T13:01:55.255Z -->
Spec: xterm-cell-grid, xterm-sync-resize, live-view

Structural ownership repair landed at `5a46c8154`: the xterm installer’s single array is now three ordered named groups (synchronized resize, cell grid, browser pointer selection), concatenated in the original order. `xterm-cell-grid` directly governs only `cellGridPatches`; the sibling contracts use scoped related anchors for their own groups. This removes the false cell-grid drift caused by the unrelated live-view pointer patch without changing installer behavior or weakening the exact fail-loud source-shape guard.

Main proof: installer idempotence plus Dashboard styles regression 19/19; spec lint 0 errors / 46 warnings. The relevant frontend-e2e scenarios remain stale because static installer evidence is auxiliary, not browser closure. Issue `xterm-cell-grid-source-axis-includes-unrelated-l` is closed with that scope explicitly recorded.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T13:04:57.983Z -->
Spec: hook-dispatch, xterm-cell-grid, xterm-sync-resize, live-view

Follow-up checkpoint at main `ef720967c`: `hook-dispatch` received a reasoned L0 import-path acknowledgment only; its manifest/compiler contract did not change. The xterm ownership issue is closed at `5a46c8154`: three ordered named installer groups let cell-grid directly own only its geometry patches, while resize and pointer-selection receive scoped related coverage. Installer idempotence and Dashboard styles regression passed 19/19; no static test was represented as frontend-e2e closure.

Current global truth after a full run: spec lint 0 errors / 45 warnings; eval lint 138 flagged nodes, 607 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. The stale count moved because the structural code-axis repair made existing xterm/live-view readings visibly stale; it is not being called either a regression or a green result. Next bounded evidence task is real-browser remeasurement of remark-polish/dangling-orphan-visible, whose prior fresh CLI reading cannot close its frontend-e2e claim.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T13:13:11.890Z -->
Spec: remark-polish, global-drift-remediation-bounded-backlog-axis-re

Real Chromium remeasurement for remark-polish/dangling-orphan-visible landed at 77e414c60. The old fresh record included image/data/video artifacts but its verdict only asserted CLI and model behavior; it did not assert the declared NodeView visible state. The new reading is anchored to main 3572a3ab0 and ran the same disposable product loop twice: a real CLI remark on old-name, deleting only old-name, then a real Chromium Eval pane rendered one struck-through scenario-gone row with the exact still-open remark body. The result timeline contains one dangling item and no old-name result item; declared-unmeasured keep remains a blind spot; normal CLI retract clears the dangling warning. Screenshot, video, timeline, and structured result are attached.

This is evidence-surface closure only: no product source, freshness, gate, score, or scenario-selection semantics changed. Full current baseline remains spec lint 0 errors / 45 warnings and eval lint 138 flagged nodes, 607 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T13:30:10.276Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, remark-polish, session-attach, keyboard-nav, sessions-core

Checkpoint at main 46757bba6:

- Same-surface closure: 77e414c60 added a real Chromium reading for remark-polish/dangling-orphan-visible. The previous record had artifacts but did not assert the declared NodeView state; the new disposable CLI-to-browser loop visibly renders one struck-through scenario-gone row with its open remark body. The keep control remains a blind spot and normal retract clears the dangling warning. No product source or drift/gate semantics changed.
- Two isolated spec warnings were mechanics-only and independently reviewed before ACK: session-attach removed only a file-header comment duplicating its local/TTY/offline/tmux contract (d56d31ba2); keyboard-nav removed only duplicated registry commentary while ACT entries, glyph map, bindings, and legend consumers stayed unchanged (1536d83ad). No runtime behavior was represented as an ACK.
- Structural source-axis repair: sessions-core/pane-snapshot-survives-the-installed-tmux was the exact tmux format/parser/liveness path but governed whole spec-cli/src/sessions.ts. 6ec7013ce narrows its scenario axis to TMUX_PANE_SEPARATOR, TMUX_PANE_FORMAT, parseLivePanes, and liveSnapshot. 46757bba6 then remeasured against the installed tmux with production list-panes format and parser, 5/5 passing. This is not an eval semantic change: the same scenario still stales if any of those units move, while unrelated sessions.ts churn no longer invalidates it.

Main post-merge proof: sessions-hot.test.ts 5/5, spec lint 0 errors / 43 warnings, full eval lint 138 flagged nodes, 606 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. sessions.ts now has 42 whole-file scenario owners (down from 43); the remaining 11 sessions-core stale scenarios remain visible. No bulk ACK, threshold, freshness, gate, score, or scenario executor change occurred.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T13:55:43.243Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, issues-view, mentions, reply-thread

Real Chromium closure for issues-view/new-issue-page landed at 57dae7784, anchored to main 2adbfeadc. On a disposable project, #/issues/new created a local issue through the actual .fv-post control; its real shared Thread.jsx composer visibly offered @new, launcher selection wrote @new:fake plus prose into the textarea, and Send durably posted it. API read-back retained the exact reply; the visible transient receipt named one online fake-launcher worker with parent=null. There were no page errors or failed issues/session requests. The initial .fv-send timeout was a runner selector error (that control belongs to the detail composer), not a product failure, and no false-fail record was filed.

This remeasurement closes only new-issue-page. Lane-local eval lint still exposes the other 13 stale issues-view scenarios, including composer-mention-autocomplete; none were bulk-acknowledged or inferred green from this adjacent run. Current main post-merge baseline: spec lint 0 errors / 43 warnings; eval lint 138 flagged nodes, 605 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. No product source, drift/freshness threshold, gate, score, or scenario executor changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T14:22:14.450Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, issues-view, mentions, reply-thread

Real Chromium closure for issues-view/composer-mention-autocomplete landed at 0f29d6de7, anchored to main f90fdce60. A disposable persisted session record was projected by the real sessions API as offline, then the docked issue composer visibly listed that retained row and selection inserted its complete session id. The same browser run covered worker-launcher completion, spec-node completion, Escape preserving draft and route, inert plain prose, the downward menu on the compose page, and the session console regression. There were no page errors and no failed issues/session requests; the result separately preserves Vite-only /projects requests outside the scenario.

The existing batch browser runner did not seed an offline retained session and therefore could not establish that declared leg; this reading supplies the missing input through the production record projection rather than a mocked API. Its batch invocation also emitted three failures belonging to other stale scenarios (two list-page checks and one node-link check). They were not filed as product failures or covered by this pass because they were not independently diagnosed.

Current main post-merge baseline: spec lint 0 errors / 43 warnings; eval lint 138 flagged nodes, 604 stale, 0 malformed, 0 missing, 0 coverage gaps, 39 over-owned. No product source, drift/freshness threshold, gate, score, or scenario executor changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T14:28:31.430Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, reply-thread, mentions, issues-view

Closed one bounded spec-only warning. The current Thread delta imports the shared launcher registry and passes it to the existing mentions hook; it does not add a composer menu or a Thread-owned dispatch path. Delivery remains caller-owned through onSend(author text, evidence). Fresh Chromium coverage on the shared issue-thread surface exercised the resulting launcher choice, durable reply, node completion, keyboard closure, and an offline retained-session fixture. Main now carries Spec-OK ack 4ded9fbfd; full spec lint is 0 errors and 42 advisory warnings.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T14:44:27.437Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re, issues-view, reply-thread, mentions

Closed one more bounded issues-view scenario on main: composer-trigger-buttons, commit 0bd67ad99. Fresh isolated Chromium created a real local issue, retained session, and spec node, then measured both symbol buttons on the docked reply composer. They insert at caret or replace the selected span, open the shared menus, preserve the draft through Escape, do not post, and keep the action row inside bounds at desktop and 780px. Video, screenshot, structured result, and timeline are filed. The issues-view lane still has 11 stale scenarios; this does not claim node-wide closure.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:04:29.772Z -->
Spec: global-drift-remediation-bounded-backlog-axis-re

Closed two bounded issues-view scenario drifts on main 202f1e236.

- list-page-skeleton: the product already had a full-row real detail anchor as a child of the structured row. The stale test required the wrapper itself to be an anchor, although that would reintroduce nested-link/control conflicts. The scenario now names the behavioral contract, maps ReviewShell plus styles as real sources, and the browser test proves the child anchor covers each row.
- new-form-node-links: the product contract requires an internal graph anchor; the stale test incorrectly required a button. The scenario and test now assert #/graph/<id>.

Real isolated backend + Vite + Chromium passed 58/0 on the committed tree. The two fresh readings contain screenshots/transcript, and the list reading includes a real UI journey video. issues-view lane-local eval debt is now 9 stale scenarios; no node-wide closure is claimed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:21:18.057Z -->
Spec: review-chrome, eval-core

Structural code-axis repair landed on main at 1d77b2726. Nineteen scenarios had anchored all of ReviewShell.jsx even though their declared user loops pass through distinct components. Each now names its actual measured ReviewShell units: ListPage/query/filter/row/state/pagination for list flows, DetailShell plus side primitives for detail flows, and CompactReviewFilter/ReviewState for the node popup. The two remaining whole-file mentions are related coverage only.

This changes neither product behavior nor drift/freshness/gate/score semantics. It also does not call existing frontend readings green: full eval lint remains 601 stale and the affected scenarios remain explicitly stale where their selected code or scenario changed. The structural owner count drops 39 -> 38; ReviewShell.jsx no longer appears in the over-owned list. Main proof: spec lint 0 errors / 42 advisory warnings; eval lint 0 malformed, 0 missing, 0 coverage gaps.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:28:05.843Z -->
Spec: evals-view, session-eval\n\nLanded 44f12997b (spec(evals-view): scope page eval axes).\n\nScope repair only: 14 direct code-axis references to spec-dashboard/src/EvalsPage.jsx now identify the actual route coordinator, list, detail, scope-door, and bounded-detail projection functions. Bare EvalsPage.jsx remains only in related context, never code:.\n\nNo product source, scenario prose/expectation, freshness rule, gate, or score changed. The prior readings were not refiled: all existing stale scenarios remain explicit. Main verification: spex spec lint = 0 errors; global spex eval lint = 138 flagged, 601 stale, 37 over-owned (structure improved from 38; EvalsPage.jsx no longer appears among the worst owners).

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:36:41.588Z -->
Spec: sessions-core\n\nLanded 88fcee284 ().\n\nScope repair only:  now owns the prompt-preview path rather than all of : , , , , and . This preserves the existing scenario contract while making the stale axis name the behavior it actually covers.\n\nNo product source, scenario prose or expectation, freshness rule, gate, or score changed. No reading was refiled: the prior reading ceased to be stale only because unrelated changes to  are no longer in its declared code axis.\n\nPost-landing verification on main:  = 0 errors / 42 warnings;  = 138 flagged (0 malformed, 600 stale, 0 missing, 0 coverage gaps, 37 over-owned). This removes one stale reading and reduces  ownership from 42 to 41.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:37:07.449Z -->
Spec: sessions-core\n\nCorrection to the immediately preceding reply: its Markdown code markers were incorrectly interpreted by the shell. This is the canonical ledger entry.\n\nLanded 88fcee284, spec(sessions-core): scope prompt preview eval axis.\n\nScope repair only. Scenario a-board-row-carries-only-the-prompt-preview now owns the prompt-preview path rather than all of spec-cli/src/sessions.ts: oneLinePreview, toSession, boardRow, listSessions, and sessionPrompt. This preserves the existing scenario contract while making the stale axis name the behavior it actually covers.\n\nNo product source, scenario prose or expectation, freshness rule, gate, or score changed. No reading was refiled. The prior reading ceased to be stale only because unrelated sessions.ts changes are no longer in its declared code axis.\n\nPost-landing verification on main: spex spec lint = 0 errors / 42 warnings; spex eval lint = 138 flagged (0 malformed, 600 stale, 0 missing, 0 coverage gaps, 37 over-owned). This removes one stale reading and reduces sessions.ts ownership from 42 to 41.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:41:10.870Z -->
Spec: step-timeline, event-detail\n\nLanded 3b58007a9, spec(step-timeline): scope detail rail eval axes.\n\nTwo frontend-e2e scenarios previously governed all of spec-dashboard/src/EventDetail.jsx. Their precise code axes now name normalizeTimeline, axisLabel, StepRail, and EventDetail, alongside their existing timeline or CLI owner. These are the v1/v2 normalization, visible labels and rail, and the detail component that assembles video and non-video evidence paths.\n\nNo product source, scenario prose or expectation, freshness rule, gate, or score changed. The two existing browser readings remain stale and require separate same-surface remeasurement; no reading was refiled.\n\nPost-landing verification on main: spex spec lint = 0 errors / 42 warnings; spex eval lint = 138 flagged (0 malformed, 600 stale, 0 missing, 0 coverage gaps, 37 over-owned). EventDetail.jsx ownership dropped 17 to 15.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:48:58.287Z -->
Spec: sessions-core, global-drift-remediation-bounded-backlog-axis-re\n\nLanded 7a9817273, spec(sessions-core): scope delivery prompt eval axis.\n\nScenario prompt-invariant-covers-every-delivery previously governed all of spec-cli/src/sessions.ts even though its prose identifies composeSessionPrompt as the delivery seam. Its code axis now names composeSessionPrompt and optionSafe only. These are the shared delivery composition path and the leading-dash normalization that makes adapter-specific escaping unnecessary.\n\nNo product source, scenario prose or expectation, freshness rule, gate, or score changed. No reading was refiled. The existing reading ceased to be stale only because unrelated sessions.ts changes no longer belong to its declared code axis.\n\nPost-landing verification on main: spex spec lint = 0 errors / 42 warnings; spex eval lint = 138 flagged (0 malformed, 599 stale, 0 missing, 0 coverage gaps, 37 over-owned). sessions.ts ownership is 40, down from 41.\n\nRead-only CSS audit: styles.css has clear scenario-local selector groups, but the current axis registry has no CSS extractor. Treating CSS selectors as code axes would require a schema/freshness behavior change. That remains outside the permitted structural work and is not being patched to chase the 28-owner count.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T15:54:32.748Z -->
Spec: local-issues\n\nLanded dfe527eee, spec(local-issues): scope reserved id eval axis.\n\nScenario reserved-address-ids now names the two complete implementation units: uniqueId owns reserved-address and collision suffix allocation; openIssue invokes it while preparing the locked store write. The scenario behavior remains unchanged.\n\nThe existing CLI reading remains stale because those named units themselves changed after its code revision. No product source, scenario prose or expectation, freshness rule, gate, or score changed, and no reading was refiled.\n\nPost-landing verification on main: spex spec lint = 0 errors / 42 warnings; spex eval lint = 138 flagged (0 malformed, 599 stale, 0 missing, 0 coverage gaps, 37 over-owned). localIssues.ts no longer appears in the worst-owner list.
