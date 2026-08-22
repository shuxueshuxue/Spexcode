# Eval closure batch twelve

Session: `51f57a00`

This batch records the remaining stale scenarios for which the declared real surface exists in prose or code
references, but the current checkout has no valid isolated product fixture that can exercise the full contract.
These are NOT-MEASURED records, not verdicts. Mock HTTP servers, unit helpers, graph injection, and the
unrelated freshness browser script were inspected but deliberately not counted.

## Driver and fixture audit

| scenario | result | precise reason |
| --- | --- | --- |
| `graph-lean/scenario-prose-off-the-board` | NOT-MEASURED | `review-pagination.e2e.mjs` covers bounded review pagination, but it does not exercise the declared graph/search/prose journey. No current isolated dashboard fixture was available with the required browser search interaction and a live node timeline; no source-only substitute was filed. |
| `launcher-select/launcher-dropdown-replaces-harness-picker` | NOT-MEASURED | The declaration requires a fresh dashboard New-Session box backed by a project config containing named launchers. Existing dashboard tests do not drive the declared `.si-launcher-pop` contract end to end, and no isolated config/project/browser fixture for this picker was present. |
| `launcher-select/dropdown-honors-default-launcher` | NOT-MEASURED | The same missing real picker fixture prevents the fresh-browser/default-versus-localStorage sequence. CLI config assertions alone do not prove the dashboard selection surface, so no reading was filed. |
| `sessions-core/prompt-invariant-covers-every-delivery` | NOT-MEASURED | `session-send-cli.test.ts` uses a fake HTTP server and parser/dispatch fixtures. The declaration requires one real interactive and one real `pi-headless` session through a live backend, including a leading-hyphen message; those two live harness fixtures were not available. |
| `evals-view/session-scope-and-legacy-redirect` | NOT-MEASURED | `evals-entry.e2e.mjs` is a browser driver, but it requires a live session with current worktree-rooted readings and a serving eval projection. The isolated current backend's eval projection is blocked before serving by the `sessions.ts` Tree-sitter selector error; no legacy-to-canonical route result was inferred. |
| `evals-view/mobile-evals-pages` | NOT-MEASURED | No isolated current session/eval fixture reached a serving projection for the 390px browser journey. The existing browser helper cannot substitute for the missing real data and route state. |
| `session-activity/headline-is-self-summary` | NOT-MEASURED | `session-toolbar.e2e.mjs` needs a real working session with a live pane title and a second top-level session. The run available here used fixture graph interception and no live worker headline, so it was rejected as auxiliary evidence. |
| `session-activity/codex-headline-is-task-not-folder` | NOT-MEASURED | The declared proof needs a real Codex launch in a worktree whose folder differs from the task. No isolated Codex worker with that identity and a live dashboard row was available; folder/name source inspection is not the product proof. |
| `session-rename/close-refusal-is-visible` | NOT-MEASURED | `session-multi-select.e2e.mjs` stubs the close endpoint with HTTP 200 and therefore cannot exercise a non-2xx refusal. No isolated governed fixture that reaches the real close guard and retains the row was available; the successful freshness script is a different contract. |
| `session-eval/session-scope-bounds-impact` | NOT-MEASURED | The declared dashboard fixture requires a branch-scoped session with dirty, renamed, moved, stale, and unmeasured scenario axes. The current real backend rejects the scoped eval read before publication because `spec-cli/src/sessions.ts` has Tree-sitter syntax errors, so no impact model or browser comparison was filed. |
| `session-eval/session-summary-coherence` | NOT-MEASURED | The cold graph/browser race and generation fixture cannot reach the scoped eval model on the current backend: the same unextractable `sessions.ts` selector returns HTTP 503. No mocked graph stream was treated as the product proof. |
| `session-eval/proof-renders` | NOT-MEASURED | A real scoped reading/detail/export fixture could not be served while the current selector gate rejects the eval projection. The previously measured proof-bounds unit surface does not cover DOM/detail/export rendering. |
| `session-eval/session-attribution-legible` | NOT-MEASURED | No current real browser fixture with an own reading, inherited reading, and retired residual reached the scoped list; the backend projection is blocked by the same selector parse error. |
| `session-eval/eval-cli-read` | NOT-MEASURED | The declared CLI surface needs a live backend with committed and empty-diff session models. The current backend's `/api/evals` path returns the explicit unextractable-selector 503; the existing CLI test uses a fake server and is auxiliary only. |
| `session-eval/eval-door-one-chrome` | NOT-MEASURED | The browser door driver requires a live session console and a serving scoped eval list. No isolated fixture satisfied both after the selector gate failed; no anchor or history claim was inferred from JSX inspection. |
| `session-eval/branch-new-node-visible` | NOT-MEASURED | A real unmerged worktree containing a new spec/eval node and readings was not available on a serving current eval backend. The required session-scoped node-set behavior therefore remains unmeasured. |
| `session-eval/demand-priority-under-delta-backlog` | NOT-MEASURED | No 30-row real session corpus with a live delta subscriber could be driven to the demand scheduler while the scoped eval projection is unavailable at the selector gate. No internal queue test was substituted. |
| `session-eval/detail-open-measures-what-it-renders` | NOT-MEASURED | The declared large adopter fixture (840 commits / 454 nodes / 1336 scenarios) is not present in this checkout, and the current eval detail endpoint is blocked by the same selector parse error. No synthetic corpus or cost claim was filed. |

## Boundary

The shared blocker was independently observed on a current branch-local backend: `/health` returned 200, while
`/api/evals` returned HTTP 503 naming `spec-cli/src/sessions.ts` as Tree-sitter-unextractable. That is a setup/
selector prerequisite failure, not a product verdict. No product code, scenario prose, specs, acknowledgements,
or acceptance artifacts were changed; no eval rows were filed by this batch.

`git diff --check` and `spex eval lint --changed` were run after this ledger-only change. The stale declarations
remain intentionally visible until their real fixtures or selector prerequisite are restored.
