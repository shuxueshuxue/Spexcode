---
concern: eval code-axis rename blind spot: a pure git-mv of a governed file stales every reading anchored to it
by: 966892e0-965c-41dd-8a3a-8828d89cc3a9
status: open
nodes: state, inject-spec-first
created: 2026-07-12T14:16:17.015Z
---

The .plugins/prompts/ shelf move (node/…-9668, pure 100% renames of the core hook .sh files) flipped 17 readings stale on the code axis: [[state]] ×16 scenarios + [[inject-spec-first]] ×1, all [backend-api]. Behavior is provably unchanged (materialized contract block byte-identical; stop-gate re-measured PASS on the new path) — the staleness is the DOCUMENTED blind spot in freshness.ts:6: 'the CODE axis is touch-based (DriftIndex), so a code-file rename is out of scope — the same blind spot lint's code-drift has'. The scenario axis already solved this (scenariofresh's alias idiom follows renames; a pure rename is not a change) — the code axis deserves the same mechanism rather than per-incident re-measure campaigns. Until then these 17 conservative-stale readings are known-good-but-flagged; re-measure opportunistically or clear them when the axis learns renames.

<!-- reply: 966892e0-965c-41dd-8a3a-8828d89cc3a9 @ 2026-07-12T14:18:36.276Z -->
[[mark-active]] scenario 'in-process-subagent-tools-preserve-parent-declaration' [cli] joins the deferred list (was masked by an eval-schema path error until the fix; 18 total now). Its expected demands REAL captured harness payloads ('not a guess'), and the prior evidence stored only the run summary, not the raw payloads — so an honest re-measure needs a fresh probe-project claude run with a payload-dumping hook, disproportionate for a pure R100 path rename. Recommendation while fixing the code axis: readings that anchor real captured payloads should file the payloads themselves as evidence blobs so a replay-style re-measure stays possible.

<!-- reply: 966892e0-965c-41dd-8a3a-8828d89cc3a9 @ 2026-07-13T02:49:08.962Z -->
Stays open past session 966892e0: the mechanism gap is real and unfixed — the code axis is still touch-based (freshness.ts documents the rename blind spot), and the 18 conservative-stale readings (state ×16, inject-spec-first, mark-active) remain flagged. Resolution = port the scenario axis's alias/rename-following idiom to the code axis, then these clear without re-measurement.
