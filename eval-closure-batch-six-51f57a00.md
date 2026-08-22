# Eval closure batch six

Session: `51f57a00`

Requested measurement tree: parent `f0c029b51`.

The required runtime pair was verified as Node `v22.21.0` and npm `10.9.4` using absolute paths under
`/home/jeffry/.nvm/versions/node/v22.21.0/bin/`. The inherited shell PATH instead resolves `node` and `npm`
to `/home/jeffry/.local/bin` (Node `v24.15.0`, npm `11.12.1`); an `npm exec` probe selected that newer Node
and is setup-only evidence, never a product verdict.

Every attempted product run used an isolated temporary `SPEXCODE_HOME`, `CODEX_HOME`, `SPEXCODE_TMUX`, and
unique port. No requested scenario was runnable through its required real public backend/CLI surface on this
Linux host, so no `spex eval add` rows were filed and no prior eval row was reinterpreted as a measurement.

## Requested scenarios

| scenario | result | precise reason | auxiliary evidence |
| --- | --- | --- | --- |
| `headless-explicit-stop-resume-liveness` | NOT-MEASURED | The declared public matrix runner could not start: `spec-cli/scenarios/harness-live-matrix.ts` imports missing `spec-cli/src/git.js` (`ERR_MODULE_NOT_FOUND`) under the required Node22 + local tsx path. The source-workspace build also reports unresolved workspace/type dependencies before a public session can be launched. No headless session lifecycle verdict was inferred from helper tests. | `/tmp/eval-b6-codex-headless-H8sd/run.txt` |
| `foreign-teardown-cannot-strand-a-live-agent` | NOT-MEASURED | The required two-world real-agent fixture was unavailable. No safe retained live rendezvous daemon plus same-id foreign record existed on this host, and deliberately unlinking a real user transport would be destructive. The public matrix runner was independently blocked by the missing `spec-cli/src/git.js` import. | `/tmp/eval-b6-codex-headless-H8sd/run.txt` |
| `codex-turn-completed-failure` | NOT-MEASURED | No real governed interactive Codex app-server turn producing native `turn/completed: failed` could be launched through the isolated public backend before the source runner setup failure. The passing observer tests use an in-process fake RPC server and are auxiliary only, not this scenario's public proof. | `/tmp/eval-b6-codex-observer-aux-1787385274.txt` |
| `claude-rendezvous-short-path-on-macos` | NOT-MEASURED | Authoritative host is Linux (`uname -srm`: `Linux 6.8.0-136-generic x86_64`); the required real macOS reclaude launch, `sun_path` bind, and liveness result cannot be measured or inferred here. | `/tmp/eval-b6-node-env-1787385274.txt` |
| `stranded-rendezvous-refuses-text-send` | NOT-MEASURED | The required public backend/CLI run with a real session record and live registered agent was not available. The passing in-process `sendText` fixture and fake-backend CLI parser test do not cross the real backend route, so they are auxiliary only. | `/tmp/eval-b6-stranded-aux-1787385274.txt`, `/tmp/eval-b6-send-cli-aux-1787385285.txt` |

## Setup record

- Node22/local-tsx invocation reached the runner and failed before product setup because
  `spec-cli/src/git.js` is absent; the source is `packages/spec-core/src/git.ts`.
- A source-workspace build attempt under the required npm10.9.4 pair emitted unresolved dependency/type errors
  in `spec-cli/src/cockpit.ts`, `spec-cli/src/review-acceptance.ts`, and missing built
  `@spexcode/session-application` / `@spexcode/session-selflaunch` exports. Those are setup failures, not
  product verdicts.
- `npm ci --ignore-scripts` completed under Node22/npm10.9.4 and installed local tsx; it changed only ignored
  `node_modules` state.
- No scenario prose, product source, acknowledgement, or acceptance artifact was changed.

## Verification

`git diff --check` was run after the ledger edit. `spex eval lint --changed` reports zero malformed rows; its
remaining stale findings are pre-existing and the five requested rows remain intentionally unmeasured. The
working tree contains only this batch ledger as a tracked change.
