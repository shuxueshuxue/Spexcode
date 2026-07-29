# Anchor Query Batch Audit

## Scope

- Baseline product: `55a674f386cf31c6510911044d06f60f773dcca7`.
- Candidate product: `c57ccbf0` (`perf(anchor): batch immutable lint queries`).
- Product surface: a fresh `node <source>/spec-cli/bin/spex.mjs spec lint`. The timing captures preserve the command's channel and resource output but did not record a Node binary path, so they establish a same-runtime A/B rather than a Node-major-specific claim. The final focused gates below use Node `22.21.0`.
- Fixed corpus: `/home/jeffry/.cache/spexcode-audits/source-of-truth-c9ad-branchy-commitgraph-20260729-100711/corpus`, tip `7a51e3ccf6eb8b5f8fc61021e54b499652527478`, 4,866 commits and 1,370 merges. The advancing base is first-parent commit `12d3ce44f42a4ea7e94c394d3a2482525e20f014`.

The loss function is exact product equivalence: exit status plus raw stdout and stderr from isolated processes and homes. The corpus's known `spec-cli/src/anchors.ts#anchorHitCommits` debt is the positive control; the candidate cold and advancing-tip runs both emitted `anchor-drift` and exited 1.

## Duplicate Control

The baseline exact-tip trace had 49 successful Git children: 22 `cat-file` children and 11 ordinary hunk batches. Distinct anchored selectors repeatedly asked for the same immutable `(commit,path)` images. The candidate builds one lint-local query batch, then applies each query's selector set independently. Its trace had 27 successful Git children: 2 `cat-file` children, 9 ordinary hunk batches, and the same 3 merge children.

`spec-cli/src/anchors.test.ts` has a real-Git control with two selector queries over one window. It verifies separate selector results and exactly four children: one object-format probe, one revision batch, one blob batch, and one hunk batch. A per-query implementation would execute eight children there.

## Parity

The cold and exact-tip runs used separate homes. The advancing check used one fixed-path clone: baseline seeded the base then advanced to the tip; candidate repeated the identical checkout sequence with a different home. Every compared stdout and stderr channel was byte-identical.

| State | Exit | stdout | stderr |
| --- | ---: | --- | --- |
| cold | 1 / 1 | equal | equal |
| exact-tip hit | 1 / 1 | equal | equal |
| advance seed | 1 / 1 | equal | equal |
| advancing tip | 1 / 1 | equal | equal |

An earlier advancing clone lacked the corpus's `node_modules` link and therefore emitted only the extractor-unavailable integrity error. It is excluded from the table and timing claim; the corrected clone used the same TypeScript availability as the fixed corpus.

## Measurements

These are serial alternating samples with a fresh home per implementation/sample. Kernel page cache was not flushed, so the gain is reported as this corpus's measured shape, not a universal wall-clock law. CPU is user plus system seconds.

| State | Baseline mean (wall / CPU / RSS KiB) | Candidate mean (wall / CPU / RSS KiB) | Change |
| --- | ---: | ---: | ---: |
| cold, n=3 | 4.23 / 6.77 / 282729 | 4.12 / 6.29 / 279597 | wall -2.4%, CPU -7.0%, RSS -1.1% |
| exact-tip hit, n=3 | 3.40 / 5.34 / 265532 | 3.35 / 5.02 / 265072 | wall -1.5%, CPU -6.0%, RSS -0.2% |
| advance, n=3 | 4.16 / 6.42 / 272672 | 3.75 / 5.85 / 272364 | wall -9.9%, CPU -9.0%, RSS -0.1% |

The material win is advancing-tip CPU and wall time. Cold and same-tip retain a CPU reduction while startup and unrelated source parsing keep their wall time noisy.

## Semantics

- `spec-cli/src/git.test.ts`: 31/31, including persistent reopen/advance, merge/parallel histories, rename reuse, checkpoints, and pending-cache isolation.
- `spec-cli/src/anchors.test.ts`: 14/14, including the batch child-count control.
- `spec-cli/src/lint-scoped.test.ts`: 14/14, through the real CLI for scoped code/related anchors.
- Five focused real-Git candidate-gate cases passed: undeclared anchored candidate rejection before ref advance, node-specific candidate trailer acknowledgement, empty-ack closure, `commit --only` isolation, and merge-authored anchored hunk ownership. The real prepared-commit hook also accepted the candidate with its explicit self-only `Spec-OK: spec-lint` trailer.
- `spec-eval/src/sessioneval.test.ts`'s public exact-revision projection passed, preserving the selector-aware, delta-complete and loud public API contract.
- Node `22.21.0` focused CLI suites passed 40/40 (`anchors`, `lint-scoped`, and `lint-source`); `spec-cli` and `spec-eval` TypeScript checks passed; product `spec lint` reported 0 errors and 43 advisory warnings.

## Rejected Route

A shared rename-side reachability memo retained byte parity on this corpus but only produced 3-5% directional readings with no RSS win. It was removed rather than retained as an additional layer. The landed route instead removes a measured repeated Git operation with one build-local batch and no resident cache, fallback, or new identity model.
