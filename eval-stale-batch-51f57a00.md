# Stale backend/CLI eval batch

Session: `51f57a00`

Measured tree: `bdc0120f2d3038eadf6180e8eefee51cbe1f3eba` (`bdc0120f2`).
Every runnable reading below was executed with Node `v22.21.0`, npm `10.9.4`,
the worktree cwd `/home/jeffry/spexcode/.worktrees/Continue-eval-stale-closure-on-current-head-453e`,
and isolated temporary `SPEXCODE_HOME` and `CODEX_HOME` directories. Evidence is
kept outside the repository under `/tmp/eval-stale-bdc0120f2/` and was filed by
`spex eval add` only after the measurement.

## Mappings and readings

| requested scenario | exact real surface and command | verdict | evidence |
| --- | --- | --- | --- |
| `session-fail/machine-turn-failure-is-one-active-only-cas` | No runnable real backend/CLI or YATU command covers the shipped StopFailure entry plus native/headless writer in all three required record states. The named `spec-cli/src/sessions.test.ts` test calls internal writers directly and was not substituted. | NOT-MEASURED | No reading filed. |
| `spec-cli/edit-shows-uncommitted-node` | Live backend started with `node --import tsx spec-cli/src/index.ts`; YATU fetched `/api/edit` for an untracked spec, tracked edited spec, and tracked unchanged spec. | PASS; filed with `spex eval add spec-cli --scenario edit-shows-uncommitted-node` | `/tmp/eval-stale-bdc0120f2/edit-shows-uncommitted-node.txt` |
| `spec-cli/server-reaps-abandoned-connections` | Live backend with `SPEXCODE_REAP_HEADER_MS=250` and `SPEXCODE_REAP_IDLE_MS=250`; YATU opened a raw TCP partial-header request and held `/api/graph/stream` for 900ms. | PASS; filed with `spex eval add spec-cli --scenario server-reaps-abandoned-connections` | `/tmp/eval-stale-bdc0120f2/server-reaps-abandoned-connections.txt` |
| `spec-cli/board-conditional-request` | Same public backend surface; YATU performed `/api/graph`, matching `If-None-Match`, and stale `If-None-Match` requests. | PASS; filed with `spex eval add spec-cli --scenario board-conditional-request` | `/tmp/eval-stale-bdc0120f2/board-conditional-request.txt` |
| `tsx-test-runner/source-session-materialize-keeps-node-loader` | Existing real source API test: `./node_modules/.bin/tsx --import ./scripts/test-home.mjs --test spec-cli/src/session-create-transaction.test.ts` (named public session-create transaction test). | PASS; filed with `spex eval add tsx-test-runner --scenario source-session-materialize-keeps-node-loader` | `/tmp/eval-stale-bdc0120f2/session-create-transaction-final.txt` |
| `host-resource-budget/leaf-identity-changes-during-stop-guard` | No public backend/CLI/YATU runner. `spec-cli/src/sessions.test.ts` test `stop revalidates the exact leaf after every shared guard before TERM and KILL` monkeypatches `process.kill` and internal harness state, so it is not a real product-surface measurement. | NOT-MEASURED | No reading filed. |
| `sessions-core/prompt-invariant-covers-every-delivery` | No existing real surface sends the required leading-option message through both an interactive harness and `pi-headless` and proves the agent response. `session-send-cli.test.ts` is parser/fixture-only and the existing `session-timeline.api.test.ts` YATU uses ordinary prompts, so neither substitutes for this scenario. | NOT-MEASURED | No reading filed. |
| `session-eval/session-impact-exact-revision` | Existing public HTTP YATU test: `./node_modules/.bin/tsx --import ./scripts/test-home.mjs --test spec-eval/src/sessionimpact.api.test.ts` (`scoped HTTP session impact is the selector-aware exact projection, including dirty overlays`). | PASS; filed with `spex eval add session-eval --scenario session-impact-exact-revision` | `/tmp/eval-stale-bdc0120f2/session-impact-exact-revision.txt` |

## Filed readings

The five pass readings above were filed after measurement. `spex eval add`
reported each reading at `bdc0120` and recorded the measured commit SHA
`bdc0120f2d3038eadf6180e8eefee51cbe1f3eba`; no `eval add` was issued for the
four NOT-MEASURED scenarios.

## Invalid attempts

- The first transaction-test invocation used `--import scripts/test-home.mjs`
  without `./`; `tsx` reported `ERR_MODULE_NOT_FOUND` before loading the test.
- A retry used a nonexistent absolute `node_modules` path and exited 127 before
  loading the test. The corrected `PATH=/home/jeffry/.nvm/versions/node/v22.21.0/bin:$PATH`
  plus `./node_modules/.bin/tsx` invocation passed.
- The first `/api/edit` fixture clone had no local `main` ref. The untracked
  route passed, but the tracked-edit route was empty because fork-base setup
  could not resolve; this was classified setup-invalid and excluded. A clone
  with `git branch main origin/main` passed all three route assertions.
- An attempted `spex eval add` for the NOT-MEASURED `session-fail` scenario
  pointed at a nonexistent result file and failed `ENOENT`; it created no
  reading and is not a verdict.

No product code, scenario declaration, or acceptance/review artifact was
changed in this batch.
