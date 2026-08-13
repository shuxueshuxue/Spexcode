# Drift Classification

This is the review ledger for the ordinary drift set measured on the branch. It is the per-node classification
report referenced by corrective ack commit `39a5ebacc`. Each row has one legal
destination: refresh the current-state spec, acknowledge mechanics with the reason recorded by its node,
or defer with a linked issue.

| Node | Destination | Diff basis |
| --- | --- | --- |
| cli-surface | refresh | Added the Flatcode drawer and simplified merge dispatch; current CLI grammar now records both. |
| flat | ack | `acce1ed97` retires dead vocabulary in diagnostics only; conversion and round ownership stay unchanged. |
| merge-tooling-resilience | refresh | Launcher identity scrubbing is now part of the packaging contract. |
| commit-surgery | ack | `023e91b4c` moves git/layout imports into spec-core; staged-content surgery is unchanged. |
| content-filter | ack | Per-tree payloads, changed-file settling, and legacy fallback removal match the existing filter invariants. |
| spex-uninstall | refresh | Retired legacy cache residue is no longer an uninstall target. |
| graph-cache | ack | `3d0e60e6` moves imports across packages and `ad98f69d8` removes dead vocabulary; cache semantics stay put. |
| graph-stream | ack | `3d0e60e6` adds the served project-root watcher and excludes linked `.worktrees`, both already in the contract. |
| issues | ack | `bd8199319` restores persisted `@new` dispatch; the issue contract already requires the visible outcome. |
| issues-cli | ack | Package imports and `summarizeDispatch` output preserve the one issue/remark composer. |
| loop-in | ack | Filing moves to the eval package; lower-layer mention de-duplication leaves one originator chain. |
| gateway-hub | ack | Package split and web-route work preserve project selection and authorized loopback forwarding. |
| delivery-queue | ack | Import relocation only; claim-insert-remove and close revocation are unchanged. |
| session-cursors | ack | Import relocation only; cursor and unread boundaries are unchanged. |
| session-follow | ack | Import relocation only; durable parent/manual follow sources are unchanged. |
| files | ack | Import relocation only; path authorization and bounded reads are unchanged. |
| harness-adapter | ack | `acce1ed97` changes one diagnostic word; adapter run shapes and lifecycle behavior are unchanged. |
| session-execution | ack | Import relocation only; execution ownership and turn outcomes are unchanged. |
| shared-runtime-generation-rotation | ack | Import relocation only; stale-generation rejection is unchanged. |
| zcode-harness | ack | Dead-word cleanup plus the already-specified one-shot adapter row; z-code launch/hooks remain unchanged. |
| harness-delivery | ack | Package split and generalized comment sentinels preserve materialize/dematerialize ordering. |
| legacy-mark-active-compat | ack | Governed fixture bytes did not change; the compatibility transformation remains identical. |
| session-new-monitor-hint | refresh | Help wording and live/archived receipt semantics are current-state text now. |
| xterm-sync-resize | ack | Workspace package/dependency declarations changed; terminal resize behavior did not. |
| manager-cockpit | ack | Import relocation only; cockpit aggregation and resource budgets are unchanged. |
| remote-client | ack | Error wording changes `reading` to `retrieving`; status and fallback semantics are unchanged. |
| session-label | ack | Test fixture drops removed `reviewEpoch`; label derivation is unchanged. |
| sessions-core | refresh | Plain merge dispatch and removal of review-generation fields are current-state behavior. |
| web | ack | `readSessionWebs` separates the existence guard from projection reads; URL and proxy semantics remain. |
| source-of-truth | ack | `d407f4211` exports the existing plugin root as a constant; detected-root loading is unchanged. |
| ci-gate | refresh | Docs-release, packed `file:` lock rewriting, and adoption-hook negative control are now specified. |
| id-url-safe | ack | `d407f4211` shares a constant; unsafe-id rejection and URL-safe minting are unchanged. |
| portable-layout | defer | `packages/spec-core/src/layout.ts` crosses layout and ZCode session-projection ownership; see github#92. |
| spec-lint | ack | Import relocation only; blocking error and advisory drift rules are unchanged. |
| adopt-nonweb-ergonomics | refresh | Explicit historical-tip source reads are now bounded in the current-state contract. |
| spec-search | ack | Import relocation only; ranking and search output are unchanged. |
| api-endpoint | refresh | The project-prefixed Vite API proxy is now current-state behavior. |
| project-identity | ack | Import relocation only; pending/locked identity rendering is unchanged. |
| address-routing | ack | Package-boundary split preserves hash/address grammar and page routing. |
| node-popup | refresh | Graph-only static read-only mode and embedded public body are now specified. |
| evals-view | ack | Browser package entrypoint import only; eval list/detail filtering is unchanged. |
| review-chrome | ack | Browser package entrypoint import only; filters and URL replay are unchanged. |
| paged-palette | ack | `3d0e60e6`/L0 rename relocate rank/query imports; real-result paging remains. |
| paged-review | ack | Package entrypoint relocation only; page bounds and cursor semantics remain. |
| pagination-evidence | refresh | Node preview now asserts one latest result per scenario and one full-list door. |
| launch-hero | ack | `LaunchHero` anchor is unchanged; neighboring session drag ghost already matches the 75% contract. |
| esc-layers | ack | `49640a900` and `0696f8c9c` change nav/type and Command Box comments; LIFO capture behavior is unchanged. |
| icon-system | ack | `795dc7e45` adds the centralized `corner-up-left` reparent/detach glyph; `f80fab688` removes obsolete `grip-vertical`. |
| eval-core | ack | Package imports only; scenario hash/projection, relation parsing, and validation are unchanged. |
| eval-score-badge | refresh | Server-computed summary tally and local fallback are now specified. |
| eval-tab | ack | Package entrypoint relocation only; tab classification and timeline behavior are unchanged. |
| evidence-put | ack | `spec-eval/src/cli.ts` changes are outside anchored `blobPut`; hashing/storage/receipt remain unchanged. |
| session-eval | ack | `bf224c540` makes host capability failures explicit; projection now states that error boundary. |
| step-timeline | ack | `156caa401` removes comments only; v1/v2 validation and normalization are unchanged. |
| forge-cli | refresh | Current output says traced records; the spec now uses that current wording. |
| forge-host | ack | `156caa401` removes comments only; host precedence and driver-less degradation are unchanged. |

The one deferred row is intentionally not silent: github#92 records the ownership question and the exact fields
that block a judgment.
