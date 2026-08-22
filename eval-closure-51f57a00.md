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
`launch/cap-value-comes-from-spexcode-json`, and
`session-nesting/whole-row-drag-reparents-and-detaches`. They remain baseline-only or
unmeasurable here because their declarations require a manual live-board,
dashboard, or multi-process run not provided by an existing scenario command.

The final `spex eval lint --changed` also reports the existing malformed-anchor
condition for `state/explicit-stop-is-authoritative-offline`: its
`spec-cli/src/sessions.ts` anchor cannot be verified because Tree-sitter reports
syntax errors. This is recorded as an advisory baseline condition; the scenario
was not reclassified as a product pass or fail.

The first serial run reported one failure in `session-reparent.test.ts` only
because three zero-byte test-created markers (`node`, `npm`,
`spexcode@0.6.7`) made the fixture's dirty-tree guard fire; removing those
artifacts and rerunning the same test passed. It is not a product failure.

## First stale batch (Session: 51f57a00)

All filed readings in this section use codeSha `8650d4b657f514e152b47ba2dc421907ccd7fa25`, the committed
code that was measured. Commands used `/home/jeffry/.nvm/versions/node/v22.21.0/bin/node` (`v22.21.0`) and
npm `10.9.4`; test-created projects used isolated `SPEXCODE_HOME`, `CODEX_HOME`, and unique tmux/ports where
the surface creates them. No review-acceptance run was started by this batch.

### Filed

- `behavioral-benchmark`: no readings filed. The five requested benchmark scenarios
  (`weak-instruction-single-session`, `forced-swarm-write-collection`, `layered-session-delivery`,
  `slopcodebench-file-backup`, `slopcodebench-code-search`) have declarations and historical transcripts only;
  this checkout has no runnable Terminal-Bench/SlopCodeBench driver for them. The existing `m5-zswarm-adopter.mjs`
  is a different adopter loop and was not substituted.
- `packaging/clean-install-cli-starts`: **fail**, filed from `/tmp/eval-clean-init-smoke.d4g3pt/run.txt`.
  `scripts/clean-init-smoke.mjs` packed and installed a clean consumer under Node22, then installed `spex --help`
  exited 1 because `@spexcode/spec-eval` could not resolve from `@spexcode/spec-cli/dist/eval-host.js`. A normal
  offline tarball install reproduced the same layout (`/tmp/spex-normal-install.d3Xope`); this is a deterministic
  packaging defect, not a fixture omission. No product code was changed.
- `packaging/cli-package-install-resolves-core`: **pass**, `/tmp/eval-closure-51f57a00/packaging-cli-package-install-resolves-core.txt`.
  Root `npm ci`, package-local `npm ci`, and `npm run -s lint` all exited 0 under Node22.
- `packaging/omit-optional-l0-adopter`: not measured. The existing clean-install YATU surface stopped at the
  failed installed `spex --help` prerequisite, so no L0 verb or optional-daemon refusal was exercised.
- `packaging/dev-loop-launch-no-prefix-leak`: **pass**, `/tmp/eval-closure-51f57a00/packaging-dev-loop-launch-no-prefix-leak.txt`.
  The existing `launcher-tsx.test.ts` `npm run api` process-tree surface reached health and passed the scrub check.
- `spex-init`: **pass** for all five requested scenarios (`honest-plant-message`, `no-vote-adoption`,
  `retired-field-notice`, `selected-harness-artifact-report`, `selected-harness-reachable-hook-seed`) from the
  real `spec-cli/src/init.test.ts` suite (11/11), `/tmp/eval-closure-51f57a00/spex-init-suite.txt`.
- `mentions/passive-session-reference`: **pass**, `/tmp/eval-closure-51f57a00/mentions-passive-session-reference-node22.txt`.
- `mentions/command-box-new-launcher`: **pass**, `/tmp/eval-closure-51f57a00/mentions-command-box-new-node22-repro.txt`.
  This is the only valid reproduction used: it prints Node22/npm10.9.4 and passes 1/1 in an isolated home.
- `sessions/zcode-child-eval-identity`: **pass**, `/tmp/eval-closure-51f57a00/sessions-zcode-child-eval-identity.txt` (1/1).
- `session-new/create-name-reuses-the-session-name-chain`: **pass**, `/tmp/eval-session-new-final.aQP8ww/run.txt`.
  The real dashboard/CLI e2e passed with isolated backend/UI ports and home.
- `launcher-select/clean-init-launchers-preserve-permissions`: **pass**, covered by the same Node22 init suite.

### Not measured / blocked

- `sessions/launch-node-binding`: no declared test or existing YATU runner in this checkout; not substituted with an
  internal helper.
- `launch/cap-counts-only-the-working-set` and `launch/cap-value-comes-from-spexcode-json`: no existing real-board
  cap driver; the declarations require a live multi-session board and drain observation.
- `launcher-select/launcher-dropdown-replaces-harness-picker` and `launcher-select/dropdown-honors-default-launcher`:
  no existing dashboard test drives the declared `.si-launcher-pop` picker contract; autocomplete tests are a
  different surface and were not counted.
- `state/session-verb-chain-v030`: no runnable end-to-end CLI/TUI chain driver is present in this checkout.

### Invalid / flaky evidence retained but excluded

The first full `mentions-command.api.test.ts` run under the Node22 PATH passed `@session` but timed out waiting for
the `@new` source prompt; its complete output is `/tmp/eval-closure-51f57a00/mentions-command-box-api.txt`. The
later isolated absolute-Node22 reproduction passed 1/1 and is the filed reading. A separate attempted reproduction
printed `environment: node=v24.15.0 npm=11.12.1` and exited 124 (`/tmp/eval-closure-51f57a00/mentions-command-box-new-repro.txt`);
that v24 result is explicitly **void**, is not a reading, and is not used as load/flakiness evidence. No process from
that attempt remains.

## Final closure checkpoint

This addendum is the current ledger state after the later measurement batches. All measurements below used the
absolute Node `v22.21.0` and npm `10.9.4`; Node 24/npm 11 setup output was excluded from verdicts. The branch was
clean before each filing, and every reading names the committed tree that was actually measured.

### Headless adapter stop/resume

- `claude-headless-explicit-stop-resume`: **PASS**. A real isolated session stopped, resumed with the same pinned
  launcher and native conversation, then closed. Reading codeSha: `cc113f64d`.
- `opencode-headless-explicit-stop-resume`: **PASS**. Stop and resume used the same pinned `opencode-sub2api`
  command and `--continue`; the temporary live worker was explicitly cleaned after the run. Reading codeSha:
  `c9c633c00`.
- `pi-headless-explicit-stop-resume`: **PASS**. Stop/resume/close completed with the same pinned `pi` adapter and
  session identity. Reading codeSha: `e5b7641ba`.
- `codex-headless-explicit-stop-resume`: **FAIL**. A real governed Codex session completed its first turn, but
  `spex session stop` refused because the detached app-server had no exact governed thread identity and the record
  had an empty `harness_session_id`; stop/resume was therefore not claimed. Reading codeSha: `aed50d51f`.

The generic `headless-explicit-stop-resume-liveness` scenario remains stale because its contract covers every
registered headless launcher, not just the three passing adapters. The Codex failure is preserved as a product
finding, not downgraded to setup noise.

### Later batch filings

Batch nine is integrated as `5b1f9c163`, byte-for-byte equivalent to candidate `379b40e08`: the clean tarball
optional-adopter matrix passed and the eval-detail source-resolution/unmeasured-state browser/API surface passed.
The batch-five through batch-nine ledgers retain precise `NOT-MEASURED` reasons where their declared real driver
was unavailable; no fake PASS rows were added for those cases.

### Remaining advisory inventory

The final branch-local `spex eval lint --changed` reports `0 malformed`, `0 missing`, `0 coverage gap`, and stale
rows only. The stale rows are the existing inventory of contracts whose declared real surface was not re-executed
on this tree: the five Terminal/SlopCodeBench behavioral benchmarks; graph-lean prose search; the unmeasured
harness-adapter multi-world/foreign-teardown/Codex failure and platform-specific cases; the two live cap-board
scenarios; dashboard launcher picker, nesting, activity, rename, and eval-scope/browser scenarios; the manager
movement trace; the sessions-core all-delivery prompt invariant; and the v0.3 CLI/TUI verb chain. Their batch
ledgers record the exact missing fixture, unavailable platform, or setup prerequisite for each; stale is not a
PASS and not a product FAIL.

The current branch-local `spex spec lint` result is `0 error(s)`; its warnings are existing drift/related-drift
findings. Alternate launcher runs that reported Tree-sitter errors on `cli.ts` or `sessions.ts` are tool/checkout
path observations and are not used to reclassify product behavior here.

### Files preview browser closure

`files/preview-refuses-unsupported-or-oversized-files-loudly` is now **PASS** at codeSha `576785b5e`. The
measurement used an isolated git project initialized through the public `spex init`, posted both fixtures through
`spex session files add`, served the real backend and Vite dashboard, and drove Chromium through the resource-tab
surface. An SVG preview produced the exact named 415 instruction to download; a 2 MiB+1 text file produced the
exact named 413 ceiling with the actual byte count. Neither case used the download action, and the temporary
worktree, backend, dashboard, and browser were removed after the run. Structured evidence is `e1e023be…` in the
files eval sidecar.

### Files browser closure

Three additional files scenarios are now **PASS** at the same measured commit `73f6567ef`:

- `dashboard-shows-live-files-and-downloads-current-bytes`: Chromium opened the published HTML through the
  dashboard, observed changed current bytes through a browser request, and completed the live download.
- `markdown-previews-select-and-start-at-the-top`: the Markdown resource surface rendered the posted heading,
  exposed no raw text block, and began at `scrollY=0`.
- `html-previews-run-with-full-browser-capabilities`: the posted HTML ran with the intended same-origin browser
  capabilities, updated bytes were observable, and the download completed as `live.html`.

The proof used the public CLI, the real branch-local backend, Vite, and Chromium in one isolated project. The
download result is recorded through the browser download event and a direct browser-context GET; Playwright's
download-body restriction is not presented as a product failure. Structured evidence is `8c004b91…` in the
files eval sidecar. The three rows were filed in commit `66cafdc85`; the `codeSha` remains `73f6567ef` because
that is the committed tree measured before the sidecar-only filing commit.

### Live cap-board closure

The two launch-cap scenarios were remeasured through the real HTTP backend and public CLI on an isolated git
project, with absolute Node `v22.21.0` and the repository's committed `spec-cli/dist`. The fixture launcher was the
repository fake harness, held online long enough for board liveness to become observable; no shared backend or
session store was used. The measured implementation commit is `b2830380e`.

- `launch/cap-counts-only-the-working-set`: **PASS**. `maxActive=2` produced two `working/online` sessions and a
  third `queued/offline`; turning one worker into `asking/online` released a slot and drained the queued session.
  Raising the live JSON cap to 3 launched a fourth session. Lowering it to 1 did not kill the three existing workers;
  a fifth session remained `queued/offline`.
- `launch/cap-value-comes-from-spexcode-json`: **PASS** for the live JSON leg. The same backend observed
  `sessions.maxActive` changes `2 -> 3 -> 1` without restart, and the queue behavior followed those values. This
  result does not replace the earlier readings that cover env fallback, default, and floor behavior.

The complete board snapshot, including session ids and liveness, is the structured evidence attached to the two
readings. The filing itself is a sidecar-only change; no product source was changed.

### Launcher resume pinning recheck

`launcher-select/resume-replays-original-launcher-not-current-default` was measured through the real HTTP backend
and public CLI on an isolated project with absolute Node `v22.21.0`. The named-launcher half passed: a session created
under launcher A regenerated the same A command after the configured default changed to B. The unnamed/default half
**failed**: its pre-resume launch script did not contain the original A command, and after the default switch its
resume script contained B. The scenario contract explicitly requires the unnamed session to freeze the command that
actually launched it, so this is a product finding rather than a setup failure. Evidence is in the failed reading at
the current implementation commit `9fc859f59`; no product fix was made in this eval-only lane.

The initial FAIL is now **retracted**. Its driver used `exit 0` launcher shims, so `stop` never made the worker
offline, and the second case inherited the first case's switched default. That was a fixture error, not a product
finding. A corrected run used live rendezvous wrappers, reset the default to A for each case, and measured both
named-A and unnamed/default-A sessions: `stop=0`, switch default to B, `resume=0`, and both regenerated launch
scripts retained A with no B. The replacement PASS is filed against `ac37a8df6`; no product change is needed.

### Clean-install recheck

The earlier `packaging/clean-install-cli-starts` failure is superseded by a current-tree measurement. On Node
`v22.21.0`, `scripts/clean-init-smoke.mjs` packed the current root, installed it offline into a clean consumer, ran
the installed `spex --help`, and completed all four production init cases (Python/Claude, Python/Codex,
TypeScript/Claude, TypeScript/Codex). All passed without network. The current tarball contains bundled
`@spexcode/spec-eval`; the old missing-module result came from an older package state. Replacement PASS is filed at
`e7e7c45a6`; no manifest change was required.

### Current cutover recheck

The committed-head HTTP YATU was rerun on `2e03a38f4` with absolute Node `v22.21.0`, an isolated project/home,
and no inherited backend URL or port. The real backend and public HTTP surface completed all ten stories:
parent/child replay, multiple watchers, reparenting, state-transition replay, restart recovery, generation
fencing, ordered delivery, publish-before/after-watch ordering, independent session pairs, and the twice-run
JSON migration marker. Result: **10/10 PASS**; transcript evidence is `760ab1b38457…`.

The same run exercised the active `SPEXCODE_HOME` database path rather than a database override. The first migration
created the marker and backup and reported `replayed=false`; the second reported `replayed=true`; the live backend
then replayed the migrated session and exposed its event through `/events`.

The Node22 workspace build also passed all eleven workspace builds. A dry-run root package contained 399 files,
including bundled `@spexcode/session-application` and `@spexcode/spec-eval` runtime distributions. `spex spec lint`
remains `0 error(s) / 21 warning(s)` with existing drift only. `spex eval lint --changed` remains advisory at
`0 malformed / 0 missing / 0 coverage gap / 30 stale`; the stale rows are explicitly unmeasured contracts, not
green readings. No production source changed in this recheck.
