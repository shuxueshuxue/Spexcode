# Eval closure batch ten

Session: `51f57a00-a555-448d-9dbd-76430cd56f61`

## Measured

- `session-eval/proof-bounds-declared`: PASS on Node `v22.21.0`.
  The worktree runner `spec-eval/src/sessioneval.test.ts` passed `25/25`; the first four
  assertions are the declared-bounded proof contract (retired residual excluded, declared
  latest selected, newest-per-declared wins, and an empty declaration scores nothing).
  Reading was filed with `codeSha=1e8978cbc` and committed by `da0909255`.

## Not measured

- `session-eval/eval-cli-read` and the dependent real HTTP/browser session-eval surfaces were
  not given a verdict. A backend built from this worktree was started on an isolated port
  with an isolated `SPEXCODE_HOME`; `/health` returned `200`, but the real
  `/api/evals?q=is%3Aeval%20scope%3A51f57a00-a555-448d-9dbd-76430cd56f61&page=1`
  returned `503`:
  `session impact selectors on 'spec-cli/src/sessions.ts' are unextractable ... Tree-sitter syntax errors`.
  This is a shared selector precondition failure, not a product PASS or FAIL for the eval page.

- The isolated migration input also contained legacy root records with `parent: ""`, which
  the current migration contract rejects as an invalid parent. For this probe only, the copied
  records were normalized to `null`; the live JSON store and product code were not changed.

No browser verdict, CLI verdict, or reading was fabricated from the `503` response. The remaining
stale scenarios still require their declared real drivers or a repaired selector prerequisite.
