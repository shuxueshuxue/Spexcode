# Eval closure batch three

Session: `51f57a00`
Measured commit: `aa93664606b60f0782ed8b32105a90b5e349e4b6`
Ancestry: `git merge-base --is-ancestor aa9366460 HEAD` exited `0`.
Environment: Node `22.21.0` (`/home/jeffry/.nvm/versions/node/v22.21.0/bin/node`), npm `10.9.4`, isolated `SPEXCODE_HOME`, ports, and temporary fixture directories. `npm ci --ignore-scripts` and the repository build completed before measurement.

Evidence is outside the repository under `/tmp/eval-closure-batch-three-337d/`.

| Scenario | Result | Evidence / reason |
| --- | --- | --- |
| `remote-client/cwd-backend-wins` | PASS | Real Node 22 CLI against two live backends; B cwd listing returned zero rows and excluded A-only marker. Evidence `remote-routing.txt`, hash `7650cd5fb57446d335f44641a2d1b5a2faebfc9c1b31f21d8ca9d4f55f4e58d6`. |
| `remote-client/api-flag-overrides` | PASS | The same real run: explicit `--api` and `--port` both returned A-only marker. Evidence hash `7650cd5fb57446d335f44641a2d1b5a2faebfc9c1b31f21d8ca9d4f55f4e58d6`. |
| `remote-client/worker-env-lifeline` | PASS | The same real run: worker identity plus injected A endpoint returned A-only marker from B cwd. Evidence hash `7650cd5fb57446d335f44641a2d1b5a2faebfc9c1b31f21d8ca9d4f55f4e58d6`. |
| `ls-cjk-width/title-column-is-derived-title` | NOT-MEASURED | No real CLI/HTTP setup in this checkout produced a stable selector `label` differing from a live derived `title`; internal state injection was excluded. No verdict filed. |
| `ls-cjk-width/parent-column-and-scope-summary-follow-the-displayed-rows` | PASS | Real Node 22 `session ls --children=<parent>` rendered exactly two displayed children, direct eight-cell PARENT values, one close-pending and one starting summary, and CJK-safe title/prompt fields; scoped JSON matched. Evidence `ls-cjk-real.json`, hash `90cc8ba8c1df77d7fa0675045d3488b6261024149cdbf5771e26b4f51ebd75b9`. |
| `manager-cockpit/review-reports-measured-loss-without-grading-it` | NOT-MEASURED | Real cold HTTP review and CLI reached `gates.evals.phase=unavailable` with no counts. The real scoped Evals demand route remained `loading` and supplied no summary, so the required ready-state comparison could not be completed. This is a driver/setup limitation, not a product FAIL. |
| `manager-cockpit/review-gate-costs-the-movement-not-the-corpus` | NOT-MEASURED | No branch-local real HTTP A/B movement-trace driver with the declared git shim and state-movement matrix is present in this checkout; no internal helper was substituted. |

Setup-invalid attempts: the first two CJK fixture attempts inherited an unrelated backend and were refused by the product project-boundary guard before measurement; they were discarded, not classified as product failures. The corrected isolated fixture produced the PASS above.

Only the four PASS rows were filed with `spex eval add`; all filings use `codeSha` `aa93664606b60f0782ed8b32105a90b5e349e4b6`. No scenario prose, product code, bulk acknowledgement, or full acceptance was changed.

Verification: `git diff --check` passed. `spex eval lint --changed` completed with the repository's existing advisory baseline (`23` nodes flagged, `52` stale, `0` malformed, `0` missing, `0` coverage gaps); no out-of-scope eval sidecar was changed. The blocking spec lint baseline remains nonzero on unrelated existing integrity/anchor findings and was not altered by this batch.
