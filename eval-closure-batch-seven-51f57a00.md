# Eval closure batch seven

Session: `51f57a00`

Requested measurement tree: parent `096e67b49` (`096e67b490281ecacc057baefdc031f35d4de4dd`).

The required runtime pair was verified as Node `v22.21.0` and npm `10.9.4` using
`/home/jeffry/.nvm/versions/node/v22.21.0/bin/`. Each attempted fixture used a temporary project,
isolated `SPEXCODE_HOME`, a unique backend port, a unique `SPEXCODE_TMUX`, and temporary Git worktrees.
The first startup attempt was setup-only: local workspace package dist files were absent after `npm ci --ignore-scripts`;
`npm run build` under the same Node22/npm10 pair repaired that runner prerequisite.

No requested scenario received a product verdict. No `spex eval add` rows were filed.

## Requested scenarios

| scenario | result | precise reason |
| --- | --- | --- |
| `launch/cap-counts-only-the-working-set` | NOT-MEASURED | The isolated backend and real CLI/HTTP surfaces started, and a partial board trace was captured, but the fixture inherited the caller's unrelated parent id `01a0287b-ff20-7f91-9747-5fb67d3b38be`. Every create therefore reported `managed watch not established: ... parent ... is not a governed session`. The runner then waited for a later queued row to become online, an invalid precondition for that row, and exited before completing the required cap loop. The partial trace is discarded as setup evidence, not a product verdict. |
| `launch/cap-value-comes-from-spexcode-json` | NOT-MEASURED | The bounded cap runner was stopped after the inherited non-governed-parent fixture was diagnosed. No isolated live JSON edit/raise/lower/default/floor loop completed through the public board, so no cap-value verdict was inferred. |
| `launcher-select/missing-default-launcher-refuses-create` | NOT-MEASURED | The launcher runner was intentionally not started after the shared fixture precondition failure was confirmed. No public CLI/API missing-default create reading was completed in this batch. |
| `launcher-select/qualified-new-launcher` | NOT-MEASURED | The launcher runner was intentionally not started after the shared fixture precondition failure was confirmed. No public `--launcher` named/unknown comparison was completed in this batch. |
| `launcher-select/resume-replays-original-launcher-not-current-default` | NOT-MEASURED | The launcher runner was intentionally not started after the shared fixture precondition failure was confirmed. No public stop/config-drift/resume reading or regenerated `launch.sh` inspection was completed in this batch. |

## Setup and cleanup

- The initial Node22 source startup failed before product setup because `@spexcode/spec-core/dist/index.js` was absent;
  this was repaired by building the local workspaces with Node22/npm10.9.4.
- The subsequent cap fixture reached the public backend and CLI, but its inherited non-governed parent made managed-watch
  setup invalid. The runner's later `waitOnline` on an intentionally queued row was a harness assertion failure, not a
  product failure.
- All temporary eval-b7 runner scripts, tmux servers, launcher panes, and fixture processes were stopped or removed.
- No product code, scenario declaration, acknowledgement, or acceptance artifact was changed.

## Verification

`git diff --check` and `spex eval lint --changed` are run after this ledger edit. The working tree is intended to contain
only this batch ledger as a tracked change.
