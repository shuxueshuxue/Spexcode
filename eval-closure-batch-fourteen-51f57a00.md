# Eval closure batch fourteen

## Measured

`codex-headless-explicit-stop-resume` was exercised through a real Node 22.21.0 backend on an isolated
`SPEXCODE_HOME` and a real `codex-headless` launcher. The public `session new` path created a governed
session and the first prompt completed with the note `READY`; the global session store contained the
generated `launch.sh` and the pinned `launch_cmd`.

The public `session stop` then returned `resource-conflict`: the Codex app-server target had no exact
governed thread identity. The record's `harness_session_id` was empty. Stop therefore did not publish
offline and resume continuity was not measured. This is a product-level FAIL for the declared scenario,
not a timeout or setup-only result. The sanitized result transcript is filed with the reading.

The exact probe worktree, branch, isolated app-server, and temporary session store were removed after the
run. No existing session or shared backend was touched.

## Runner boundary

The repository's `spec-cli/scenarios/harness-live-matrix.ts` could not be used as the runner because it
imports the absent source path `spec-cli/src/git.js`. That setup defect was not used as a verdict; the
measurement above drove the public CLI directly instead.
