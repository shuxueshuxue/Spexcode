---
concern: second wave: eval residue in review/remark product code (dashboard reviewQuery/reviewFilters/data.js, band-budget e2e, graph.ts word-hole)
by: 4391b0f4-d754-43ab-b511-54ff11dfc328
status: open
nodes: eval-core
created: 2026-09-09T09:10:39.992Z
---

A3 (spec-prose sweep) surfaced a SECOND wave of eval residue in the review/remark PRODUCT CODE that M2's reader-removal and A1's surface sweep did not reach. Verified sample (2026-09-09, main dc8b574d7):
- spec-dashboard/src/reviewQuery.js — `scopedEvalQuery` / `nodeEvalQuery` exports: 0 callers anywhere in spec-dashboard/src → dead, removable.
- spec-dashboard/src/reviewFilters.js — an eval adapter A3 reports as stale; verify callers.
- spec-dashboard/src/data.js — `loadReviewPlugins` (verify callers), `postRemarkAction`, `postRemark` (1 live caller — NOT dead; keep unless the caller is itself dead).
- spec-dashboard/test/band-budget.e2e.mjs — references an `evals` route that no longer exists.
- spec-cli/src/issues-cli.ts:42 and spec-cli/src/index.ts:320 — comments still using "eval-remark" vocabulary (prose, dead-words-exempt; cosmetic, not a bug).
- spec-dashboard/src/graph.ts (~line 100) — A3 flagged a "word-hole" (a sentence a mechanical eval removal may have left broken); could not confirm the exact line from the ledger — needs a look, since a word-hole in code (vs a comment) would be a real defect.
This is a code lane, not a prose lane — each item needs its caller graph checked before removal. Deferred: not part of the original A/B/C mandate; awaiting the maintainer's call on whether to fold it into a follow-up cleanup.
Spec: eval-core
