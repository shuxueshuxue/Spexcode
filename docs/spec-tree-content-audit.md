# Spec tree content audit

Date: 2026-08-22  
Scope: current `.spec/spexcode` tree only; 362 `spec.md` nodes.  
Phase: audit only. No spec node was edited.

## Method and totals

The scan read the current `spec.md` files, their frontmatter, direct path hierarchy, `code:`/`eval:` anchors, and
the dashboard-ui cross-links. It normalized prose for exact paragraph/sentence comparison, then used word-shingle
similarity to find near duplicates. Historical issue files, generated graph payloads, and docs outside `.spec` were
not treated as current contracts.

| signal | result | interpretation |
| --- | ---: | --- |
| spec nodes | 362 | matches the assembled tree count |
| exact repeated paragraphs across nodes | 1 group | one package-build paragraph duplicated across eval/forge |
| exact repeated long sentences across nodes | 4 groups | two are the same package-build group; two are plugin-shelf prose |
| high-similarity long paragraph pairs | 1 pair | the eval/forge package-build paragraph; no other pair reached the same confidence |
| live `code:`/`eval:`-anchored nodes | 341 code-bearing matches counted by the tree scan | edits to these nodes need anchor/eval migration, not casual deletion |

The small exact-duplicate count does not mean the tree is clean. The larger risk is contract duplication with local
variants and active nodes that retain superseded behavior. Findings below are ordered by severity.

## P0: current body contradicts the approved contract

| id | nodes and evidence | finding | disposition | risk |
| --- | --- | --- | --- | --- |
| Z-01 | [`node-popup/spec.md:44-50`](../.spec/spexcode/spec-dashboard/dashboard-ui/graph/node-popup/spec.md#L44) vs [`spec-view/spec.md:28-47`](../.spec/spexcode/spec-dashboard/dashboard-ui/spec-view/spec.md#L28) | `node-popup` says a `code:` entry opens the file “under the prose ... inside the same scroll”; `spec-view` and `source-view` say no source reader is mounted and the file is an independent document/tab. This is the overturned **prose ‖ code same-screen** contract still written as current popup behavior. | Rewrite `node-popup` to describe a chip/link to `#/file/<path>` and delete the embedded/same-scroll claim. Keep the shared prose renderer and file-document ownership in `spec-view`/`file-view`. | **High**: `node-popup` and `spec-view` have `code:` anchors and browser tests; preserve anchors while moving the contract. |
| Z-02 | [`tab-strip/spec.md:164-177`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/tab-strip/spec.md#L164) | Closing a tab still mandates **focus the right-hand neighbour, else left**. The audit target explicitly names right-neighbor focus as overturned. The same section also makes `#/empty` current while carrying the old three-door explanation. | Replace the close-focus rule with the approved close semantics in one canonical tab node; move the “three doors / graph left” explanation to a clearly historical ledger or remove it. Do not infer a replacement focus order from this audit. | **High**: `tab-strip` is code-anchored and has `tabModel`/E2E coverage. |
| Z-03 | [`session-console/session-multi-select/spec.md:1-66`](../.spec/spexcode/spec-dashboard/dashboard-ui/session-console/session-multi-select/spec.md#L1) vs [`session-console/spec.md:115-118`](../.spec/spexcode/spec-dashboard/dashboard-ui/session-console/spec.md#L115) and [`app-frame/dock-modes/spec.md:94-96,137-140`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dock-modes/spec.md#L94) | `session-multi-select` is `status: active`, claims `SessionSelectBar`, checkboxes, bulk close, and an editable internal list. The parent/session and dock contracts explicitly say the duplicate `si-list`/resizer/stub was withdrawn and multi-select stayed retired. This is the clearest **si-list internal list** resurrection vector. | First freeze the node as historical/retired (or move it under a retirement ledger), then in a later batch reconcile/delete its `code:` and E2E anchors. Do not implement the described UI. | **High**: active `code:` anchor and `session-multi-select.e2e.mjs`; removal requires an anchor/eval decision. |

## P1: hierarchy or responsibility is split across the wrong branches

| id | nodes and evidence | finding | disposition | risk |
| --- | --- | --- | --- | --- |
| H-01 | [`dashboard-ui/sessions-view/spec.md:1-28`](../.spec/spexcode/spec-dashboard/dashboard-ui/sessions-view/spec.md#L1) and [`dashboard-ui/session-console/spec.md:1-20`](../.spec/spexcode/spec-dashboard/dashboard-ui/session-console/spec.md#L1) | Both are direct dashboard-ui children and both claim the live session interface/`SessionInterface`; `sessions-view` is the route/view-state adapter while `session-console` is the full surface contract. The split makes two apparent homes for the same Enter surface and duplicates selection/lifecycle prose. | Move `sessions-view` beneath `session-console` as a narrow route adapter, or merge its unique mounted-view paragraphs into `session-console` and remove the sibling node. Keep one canonical session-surface contract. | **High**: both have `code:` anchors; `session-console` has many E2E anchors. |
| H-02 | [`dashboard-ui/file-view/spec.md:1-30`](../.spec/spexcode/spec-dashboard/dashboard-ui/file-view/spec.md#L1) and [`dashboard-ui/source-view/spec.md:1-20`](../.spec/spexcode/spec-dashboard/dashboard-ui/source-view/spec.md#L1) | `file-view` owns the file document/address, while `source-view` owns the renderer, but both are siblings under `dashboard-ui` and cross-reference the same `FileView`/`SourceView` implementation. Readers cannot tell whether the address contract or the renderer is the parent boundary. | Make `file-view` the address/document parent and move `source-view` under it (or explicitly mark `source-view` as a shared implementation leaf). Keep `file-view` as the only owner of tab/address semantics. | **Medium**: both are code-anchored; path movement needs `spex spec lint` and anchor continuity. |
| H-03 | [`app-frame/dock-modes/spec.md:1-18`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dock-modes/spec.md#L1) and [`app-frame/side-nav/spec.md:18-45`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/side-nav/spec.md#L18) | The node is titled `dock-projection` while its path is `dock-modes`; rail routing, projection selection, and dock open/closed are spread across both nodes. This is not a behavior contradiction, but it is a naming/ownership trap for future edits. | Rename the node/path only after deciding the canonical split: `side-nav` owns route lights and the mirrored panel control; `dock-modes` owns projection contents and projection-local doors. Cross-link, do not copy the rules. | **Medium**: `Dock.jsx`, `side-nav`, and shell tests are shared anchors. |

## P1: duplicated prose that will drift

| id | nodes and evidence | duplicate fragment | disposition | risk |
| --- | --- | --- | --- | --- |
| D-01 | [`release-build-eval/spec.md:15-17`](../.spec/spexcode/spec-cli/footprint/packaging/release-build-eval/spec.md#L15) and [`release-build-forge/spec.md:15-17`](../.spec/spexcode/spec-cli/footprint/packaging/release-build-forge/spec.md#L15) | Three-line paragraph is word-for-word identical except package name: “emits ... from `src` to `dist` ... declarations ... CLI receives ... declared package dependency ... never source-relative ...”. | Keep package-specific facts in each leaf, but extract the shared build invariant into `packaging` and reduce both leaves to package name/config/output deltas. | **Medium**: both have code anchors (`tsconfig.build.json`). |
| D-02 | [`footprint/spec.md:11-15`](../.spec/spexcode/spec-cli/footprint/spec.md#L11) and [`footprint/residence/spec.md:18-27`](../.spec/spexcode/spec-cli/footprint/residence/spec.md#L18) | Both restate the HEAD/TAIL/MIDDLE model and the asset/wiring/machine-fact boundary; `residence` adds the current one-residence rule. The overview and leaf can drift when the footprint model changes. | Make `footprint` a short lifecycle index that links to `residence` for the residence invariant; retain only the one-sentence HEAD/TAIL framing in the overview. | **Medium**: `residence` is code-anchored; preserve the detailed leaf. |
| D-03 | [`commands/spec.md:24-30`](../.spec/spexcode/.plugins/commands/spec.md#L24) and [`skills/spec.md:14-19`](../.spec/spexcode/.plugins/skills/spec.md#L14), plus the same shelf sentence in [`review/spec.md:15-18`](../.spec/spexcode/.plugins/review/spec.md#L15) | The shelf contract (“shelf, not a surface”, recursive field-driven discovery, moving a resident changes neither identity nor gathered surfaces) is repeated verbatim/near-verbatim in three sibling shelves. | Put the shelf invariant on `.plugins` or `surface`; each shelf should state only its surface-specific purpose and link to the invariant. | **Low**: no code/eval anchors on the three shelf parents; low-risk prose-only batch. |
| D-04 | [`workspace-shell/spec.md:24-44`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/workspace-shell/spec.md#L24) and [`view-registry/spec.md:28-36`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/view-registry/spec.md#L28) | Both repeat that bare evals/issues/settings are destinations, not tabs, and that documents are address-held. This is an important invariant, but two full explanations make later tab policy edits easy to split. | Keep the user-facing workspace explanation in `workspace-shell`; make `view-registry` a concise machine contract and link to `tab-strip` for the policy. | **Medium**: both are code-anchored (`Shell.jsx`/`tabs.js`). |

## P2: legacy wording / resurrection watch list

These are not all current contradictions; they are places where old behavior is mentioned in active prose and can be
accidentally copied back as if it were live. The second phase should consolidate them into one historical section or
remove the wording after the replacement contract is stable.

| id | evidence | old contract or misleading phrase | disposition | risk |
| --- | --- | --- | --- | --- |
| L-01 | [`session-console/spec.md:180-184`](../.spec/spexcode/spec-dashboard/dashboard-ui/session-console/spec.md#L180) and [`node-graph/spec.md:35-40`](../.spec/spexcode/spec-dashboard/dashboard-ui/graph/node-graph/spec.md#L35) | “used to force a resident tab” and graph retirement are correctly described as historical, but they sit in active surface prose next to current navigation rules. | Move to a short `Retirement ledger` paragraph with an unambiguous “not current” prefix; leave current slot/navigation rule as the only normative text. | Medium; session/graph nodes are anchored. |
| L-02 | [`tab-strip/spec.md:167-177`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/tab-strip/spec.md#L167) | `#/empty` is current, but the sentence “There were three, and the third was the graph” preserves the old three-door model in the normative section. | Keep the empty-state address only if approved; remove the old door count from the normative body and record graph retirement separately. | High; tab model and `EmptyView` are anchored. |
| L-03 | [`app-frame/dock-modes/spec.md:49-67`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dock-modes/spec.md#L49) | The body narrates the old stacked strips and old rail search button before describing the replacement. It is useful archaeology but a future implementer can copy the obsolete shape. | Consolidate as one historical note; current rule should be “one dock band, projection-local doors, rail light means route only” and link to `side-nav`. | Medium; `Dock.jsx` is anchored. |
| L-04 | [`graph/node-popup/spec.md:24-30`](../.spec/spexcode/spec-dashboard/dashboard-ui/graph/node-popup/spec.md#L24) | This is a good current guard: popup is a skim/lens, document is the reading destination. It explicitly rejects “popup as primary reading surface”. | No behavior change. Preserve this sentence as the canonical anti-resurrection guard and link from `graph`/`spec-view`; do not duplicate it. | Low; code-anchored but already aligned. |
| L-05 | [`app-frame/side-nav/spec.md:20-45`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/side-nav/spec.md#L20) | This is a good current guard: one route light, projection styling in dock header, and no dock-mode lighting. It rejects the old three-state rail-light model. | No behavior change. Make this the sole rail-light owner and remove copied variants elsewhere. | Medium; `side-nav`/`Dock.jsx` are shared anchors. |
| L-06 | [`session-console/spec.md:115-118`](../.spec/spexcode/spec-dashboard/dashboard-ui/session-console/spec.md#L115) and [`dock-modes/spec.md:137-140`](../.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dock-modes/spec.md#L137) | Both explicitly reject `si-list`, `si-board-scroll`, resizer, and collapsed stub. These are aligned guards, but they sit beside the active `session-multi-select` resurrection in Z-03. | Keep one canonical “one session list belongs to dock” rule in `dock-modes`; let `session-console` link to it. Then retire the stale child node. | High due Z-03's active code/e2e anchor. |

## Suggested execution batches after approval

| batch | scope | expected gate |
| --- | --- | --- |
| 1 | Z-01/Z-02: popup code placement and tab close/empty wording. Resolve the approved replacement semantics first; no tree moves. | `spex spec lint` + focused dashboard tab/popup evals; commit code/spec together if any wording is changed. |
| 2 | Z-03/L-06: retire `session-multi-select`, remove or re-home its anchors, and leave one dock-owned session-list rule. | `spex spec lint` 0 errors + session-console/dock E2E regression. |
| 3 | H-01/H-02/H-03: move/merge hierarchy and clarify ownership without changing behavior. | `spex spec lint` 0 errors + changed-node anchor/eval lint. |
| 4 | D-01/D-02/D-03/D-04: deduplicate prose into canonical owners and replace sibling text with links. | `spex spec lint` 0 errors + `spex eval lint --changed`; remeasure affected scenarios. |
| 5 | L-01/L-02/L-03: move historical explanations into one retirement ledger; preserve L-04/L-05 as anti-resurrection guards. | `spex spec lint` 0 errors + final dashboard navigation/evidence pass. |

No batch should delete or rewrite a `code:`/`eval:`-anchored node without first listing the anchor migration and
re-running the relevant product proof. This report is the only artifact produced in phase one; the spec tree remains
unchanged.
