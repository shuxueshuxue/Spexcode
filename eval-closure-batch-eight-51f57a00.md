# Eval closure batch eight

Session: `51f57a00`

Requested measurement tree: parent `0ef176f22` (`0ef176f2221e7c351896144905b2ee972c12c003`).

The required runtime pair was verified as Node `v22.21.0` and npm `10.9.4` using
`/home/jeffry/.nvm/versions/node/v22.21.0/bin/`. The inherited shell resolves to Node `v24.15.0`
and npm `11.12.1`; that is setup-only context. A clean `npm ci --ignore-scripts` under Node22/npm10
completed, but the checkout has no built `dist` files. Per the batch instruction, no build repair was attempted
after the first source/public startup failed on the missing workspace artifact.

Every attempted product run used an isolated temporary home and a unique port. The real source backend and
the declared cockpit driver both failed before serving `/health` because
`@spexcode/spec-eval/dist/sessioneval.js` is absent. The direct source `spex session ls --json` command
fails on the same import before it can read a session fixture. No helper, unit, fake in-process, or prior
reading was substituted, and no `spex eval add` rows were filed.

## Requested scenarios

| scenario | surface / fixture check | result | precise reason |
| --- | --- | --- | --- |
| `ls-cjk-width/cjk-column-alignment` | Real Node22 source `spex session ls --json`; live backend required for a session fixture | NOT-MEASURED | The public source CLI cannot load `spec-cli/src/eval-host.ts`: `ERR_MODULE_NOT_FOUND: @spexcode/spec-eval/dist/sessioneval.js`. The backend therefore never reaches `/health`, and no real session rows can be rendered or measured. |
| `ls-cjk-width/title-column-is-derived-title` | Real Node22 source `spex session ls --json`; live session with divergent label/title required | NOT-MEASURED | The same pre-start import failure (`@spexcode/spec-eval/dist/sessioneval.js`) prevents the public CLI and backend from starting, so the required live label/title fixture is unavailable. |
| `manager-cockpit/review-reports-measured-loss-without-grading-it` | Declared `spec-cli/test/cockpit-eval-readout.mjs` against a branch-local live backend | NOT-MEASURED | The runner's real backend exits before health with `ERR_MODULE_NOT_FOUND: @spexcode/spec-eval/dist/sessioneval.js`; neither cold review nor the scoped Evals demand route can be exercised. |
| `manager-cockpit/review-gate-costs-the-movement-not-the-corpus` | Branch-local live HTTP backend with isolated runtime and git-shim A/B fixture | NOT-MEASURED | The required backend cannot start because `@spexcode/spec-eval/dist/sessioneval.js` is missing. No cold HTTP review, movement matrix, or git-argv trace was obtained. |
| `session-eval/proof-bounds-declared` | Real backend proof model and dashboard/API comparison fixture | NOT-MEASURED | The real backend entrypoint fails before serving the proof route on the missing `@spexcode/spec-eval/dist/sessioneval.js`; no public proof model or declared-versus-retired fixture was read. |

## Verification

No product code, scenario prose, specs, acknowledgements, or acceptance artifacts were changed. The only
tracked change in this batch is this ledger. `git diff --check` and `spex eval lint --changed` are run after
the ledger edit; no reading is present for any requested scenario, and no full acceptance was run.
