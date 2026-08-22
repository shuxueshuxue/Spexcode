# Session eval closure

Measured on the fixed base `b3d1aeb49` in this worktree with the repository's
Node runtime `/home/jeffry/.nvm/versions/node/v22.21.0/bin/node` (`v22.21.0`)
and npm `10.9.4`, cwd `/home/jeffry/spexcode/.worktrees/Eval-closure-lane-remeasure-the-session-related-3db6`.

Before dependency setup, `npm ls @spexcode/session-application --depth=0`
returned `(empty)` and the child had no `node_modules`; the Node 22 backend
probe could not load its local `tsx` runner. This is an environment/setup
failure, not a product result. `npm ci --ignore-scripts` followed by the
repository `npm run build` restored the workspace link
`@spexcode/session-application -> packages/session-application`; a live backend
then answered `GET /health` with `ok`.

## Executed readings

The following declared test surfaces passed sequentially through the local
`node_modules/tsx` runner under Node 22.21.0. Their individual eval readings
are filed with the resulting commit SHA:

| node | scenario(s) | evidence |
| --- | --- | --- |
| session-follow | `managed-watch-delivers-child-transition` | `spec-cli/src/session-timeline.test.ts`: 35/35 pass |
| sessions-core | `public-create-authority-routes-on-instance-identity` | `spec-cli/src/session-create-cli.test.ts`: 7/7 pass |
| sessions-core | `session-create-materializes-once`, `create-pins-an-explicit-base` | `spec-cli/src/session-create-transaction.test.ts`: 1/1 pass |
| sessions-core | `slug-own-identity` | `spec-cli/src/sessionSlug.test.ts`: 7/7 pass |
| sessions-core | `record-note-round-trip`, `corrupt-record-is-diagnosable`, `corrupt-record-exact-proof-quarantine`, `retired-session-never-revives` | `spec-cli/src/session-record-integrity.test.ts`: 1/1 pass; fixture reports `PASS: session record integrity` |
| session-new | `public-create-is-bounded-and-atomic` | `spec-cli/src/session-create-transaction.test.ts`: 1/1 pass |
| state | `materialize-failure-note-keeps-record-structured` | `spec-cli/src/sessions.test.ts`: named materialize-failure test pass |
| session-nesting | `cli-child-scope-reads-the-durable-direct-parent` | `spec-cli/src/session-ls-cli.test.ts`: 1/1 pass |
| session-reparent | `move-children-and-watch-relation`, `top-level-detach-revokes-former-supervision` | `spec-cli/src/session-reparent.test.ts`: 1/1 pass on clean rerun |
| launch | `command-preset-has-one-launch-owner`, `creation-materialize-failure-is-loud`, `deterministic-launch-failure-fails-once`, `fast-exit-retry-log-is-cause-neutral`, `launch-establishes-session-identity`, `launch-prompt-may-begin-with-a-hyphen`, `launch-script-path-is-shell-safe` | `spec-cli/src/sessions.test.ts`: 33/33 pass |
| dispatch | `merge-dispatch-keeps-landing-local` | `spec-cli/src/session-merge-dispatch.api.test.ts`: 1/1 pass |

## Not measured

These requested stale declarations have no runnable declared CLI/backend test
surface in this batch, so no verdict is invented: `session-new/create-name-reuses-the-session-name-chain`,
`sessions-core/prompt-invariant-covers-every-delivery`, `state/explicit-stop-is-authoritative-offline`,
`state/session-verb-chain-v030`, `launch/cap-counts-only-the-working-set`, and
`launch/cap-value-comes-from-spexcode-json`. They remain baseline-only or
unmeasurable here because their declarations require a manual live-board,
dashboard, or multi-process run not provided by an existing scenario command.

The first serial run reported one failure in `session-reparent.test.ts` only
because three zero-byte test-created markers (`node`, `npm`,
`spexcode@0.6.7`) made the fixture's dirty-tree guard fire; removing those
artifacts and rerunning the same test passed. It is not a product failure.
