# Session platform M4 self-launch legacy inventory

Base: `ca51f4ca5281439bbc45933402e502069100a5a0`.

Scope: one Codex session launched directly by its user, with no governed `session.json`, no board row and no
resident Spex backend. The measured product loop is `spex materialize`, real Codex-shaped hook events through
`dispatch.sh`, then the one-shot `spex-session initialize/enqueue/pending/dequeue` commands. A failed
`spex session send` is used only as source evidence for why the governed queue cannot serve this session; it is not
silently promoted into the self-launch producer surface. That boundary is explicit in
`docs/session-platform-m4-self-launch-cutover.md:34-45`.

## Result

The 20 G.1/G.2 rows classify as **5 CONSUMER / 15 NO-CONSUMER / 0 NOT-MEASURED** for the named scope.

The M4 deletion list is **empty** at this base.

- The old message-state rows L01/L02/L03/L06 are `NO-CONSUMER`, so M4 cannot call their absence a deletion.
- L05, R04, R05, R06 and R07 are real self-launch consumers, but M4's new listener does not replace the behavior
  for which they are consumed. They therefore cannot be deleted in M4.
- The remaining rows are either absent from this path or retained adopter/runtime facilities owned by M6/M7/M8.

This corrects both current milestone documents. `docs/session-platform-m4-self-launch-cutover.md:14-20` is right
that the old queue is not a self-launch message path, but wrong that fixed-root lookup is the only existing
dependency: live hooks probe L05 and write two files below its legacy session-directory shape, while materialize and
hook-spawned `spex` load R05/R06 and consume R07. Conversely,
`docs/session-adopter-cutin-plan.md:110-112` incorrectly assigns L01/L02/L03/L06 deletion to M4; no current
self-launch reader or writer exists to delete.

## Measurement and evidence

The trace mechanism is `/usr/bin/strace -f -qq -e trace=%file -s 4096`. Both disposable runs put the checkout, `SPEXCODE_HOME`, `TMPDIR`
and explicit database below a printed and asserted `mktemp -d` root. Node 24 installed dependencies; Node 22 ran
the product, as required by this lane. The traced product commit was
`ca51f4ca5281439bbc45933402e502069100a5a0`.

The exact trace envelope was:

```bash
/usr/bin/strace -f -qq -e trace=%file -s 4096 -o <trace-file> \
  bash <fixture>/run-trace.sh > <hook-events-file> 2>&1
```

`.spec/spexcode/session-runtime/self-launch-inventory/evidence/reproduce-traces.sh:1-157` rebuilds both runners and
executes that command at `.spec/spexcode/session-runtime/self-launch-inventory/evidence/reproduce-traces.sh:154-155`.
The fail-first invocation takes the inherited external `$SPEX`; the canonical invocation pins `$SPEX` to the fixture. Exact invocations are in
`.spec/spexcode/session-runtime/self-launch-inventory/evidence/README.md:12-20`.

The clean landing carries no raw byte stream. The originals are archived unchanged in the `spexcode-base` repository
at commit `d234b46083fa0717db2dde407d8f1335ec8e2f37`; its
`studies/session-platform-m4/evidence/sha256sums.txt:1-2` is authoritative:

- `trace.raw.log`: `3d4cfe09d18f59ca2a243d79826791c3144fa95c49ae3f742258d5e78c1290ac`.
- `trace.canonical.raw.log`: `9aeb75623decfb051ec02d19bc439960f85b42f5f345e4c934ea673ac39c6410`.

The first run remains fail-first evidence because inherited `$SPEX` escaped to another checkout; the verbatim
external-root access is retained at
`.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:22`. The canonical event return
codes, FIFO round trip and final lack of `session.json` are at
`.spec/spexcode/session-runtime/self-launch-inventory/evidence/hook-events.canonical.raw.txt:1-38`.

The selector
`pending\.json|timeline\.ndjson|/timeline/|cursors\.json|watchers\.json|\.delivery-locks|\.session-locks|\.revoked-senders`
matched zero canonical syscalls. That is a measured zero for this named run, not an M8 aggregate zero. The compact
verbatim syscall export is
`.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:1-22`; every omitted byte remains
recoverable from the external hash-pinned archive.

The tables below enumerate every product state/config path or path family touched by the measured loop.
Source-workspace launcher scans are one family because `spec-cli/bin/spex.mjs:17-58` recursively freshness-checks
those roots; the external raw trace is the byte-complete list of their individual members.

## File and directory access ledger

### Materialize and harness discovery

| Path on the fixture | Opener and source line | Access | Consequence if absent/unwritable |
|---|---|---|---|
| `project/spexcode.json`; optional `project/spexcode.local.json` probe | `materialize` resolves selected harnesses at `spec-cli/src/materialize.ts:243-249`; the hash shell reads both names at `spec-cli/hooks/harness.sh:179-187` | read/probe | The configured harness selection and its content hash cannot be reproduced; malformed config fails materialize loudly. The direct config access is `trace-excerpts.txt:4`. |
| `project/.spec/*/.plugins/**/{spec.md,*.sh}` and `project/.spec/*/plugin-system/**` | config loaders are invoked at `spec-cli/src/materialize.ts:243-252`; hook rows require one co-located script at `spec-cli/src/hooks.ts:14-25` | read/directories | Removing a node removes its delivered surface; keeping a hook node but removing its script makes manifest compilation throw. |
| `project/CLAUDE.md`, `project/AGENTS.md` | contract targets are assembled and written at `spec-cli/src/materialize.ts:284-319` | read, create/write | The selected harness loses its materialized system contract. A representative contract write is `trace-excerpts.txt:6`. |
| `project/.claude/settings.json`, `project/.codex/hooks.json`, `project/.opencode/plugins/spexcode.ts`, `project/.pi/extensions/spexcode.ts` | per-harness shim targets are emitted at `spec-cli/src/materialize.ts:284-337` | read, create/write | The corresponding harness no longer auto-discovers `dispatch.sh`; the Codex shim write is `trace-excerpts.txt:7`. |
| `project/{.claude,.codex,.opencode,.pi}/skills/{distill,e2e-review,taste}/SKILL.md` | skill targets are enumerated and written at `spec-cli/src/materialize.ts:295-299,339-342` | directory create, read/probe, create/write | The named on-demand skill is absent from that harness. These are retained materialized behavior, not legacy message state. |
| `project/.gitignore`, `project/.git/info/exclude` | materialized footprint reconciliation is at `spec-cli/src/materialize.ts:371-415` | read/write | Generated files cease to be hidden or clean-filtered correctly; a rewrite is `trace-excerpts.txt:8`. |
| `project/.git/config`, `project/.git/spexcode/{contract-filter.sh,contract-filter-bindings,contract-filter-root}` | filter planting is called at `spec-cli/src/materialize.ts:400-408` | directory create, read/write, chmod | Mixed tracked contract files cannot round-trip through Git's clean/smudge boundary. The planted executable is `trace-excerpts.txt:9`. |
| `<runtimeRoot>/trees/<tree>/{hooks-manifest,plugin-folders,content-hash,harnesses}` | materialize creates the slot and manifest at `spec-cli/src/materialize.ts:227-237`, then publishes receipts at `spec-cli/src/materialize.ts:353-371,409-415` | directory create, read/probe, create/write/rename | Without the manifest there is no handler list; without `harnesses`, dispatch is inert once the v1 marker exists. Manifest write/read and allowlist read are `trace-excerpts.txt:5,11-12`. |
| `<runtimeRoot>/trees/<tree>/contract-filter/{0,manifest}` | filter payloads are planted from `spec-cli/src/materialize.ts:400-408` | directory create, read/write | Clean/smudge loses the materialized payload source. The exact writer is the cited materialize call; no extra syscall line is retained because it adds no row decision beyond R07. |
| `<runtimeRoot>/harness-selection-v1` | materialize publishes the migration marker at `spec-cli/src/materialize.ts:409-415` | read/probe, create/write | Its presence makes an absent per-tree allowlist mean "inactive" rather than legacy-active; the direct write is `trace-excerpts.txt:10`. |
| `spec-cli/dist/**`, `spec-eval/dist/**`, `spec-forge/dist/**`, `packages/{spec-core,session-core}/dist/**` plus their package manifests | source launcher chooses the compiled CLI at `spec-cli/bin/spex.mjs:9-12`; `spec-cli` statically installs the eval composition at `spec-cli/src/cli.ts:1-7` | module read; source-workspace launcher also scans source roots | Missing required dist/package bytes fails the CLI/module load. Old root/internal opens are `trace-excerpts.txt:2-3`; this is R05/R06 consumption even though no old state file is opened. |

### Each real hook dispatch

| Path on the fixture | Opener and source line | Access | Consequence if absent/unwritable |
|---|---|---|---|
| `spec-cli/hooks/{dispatch.sh,harness.sh}` and the selected `.spec/.../<handler>.sh` | dispatcher locates and sources the library at `spec-cli/hooks/dispatch.sh:31-34`, then executes the manifest script at `spec-cli/hooks/dispatch.sh:77-90` | executable read | Dispatch or that handler cannot execute. |
| Git common dir and worktree top-level (`project/.git`, project root) | `hp_runtime_dir` and `hp_tree_dir` run Git at `spec-cli/hooks/harness.sh:111-132` | directory/metadata read | Runtime root and per-tree slot cannot resolve; dispatch becomes inert at `spec-cli/hooks/dispatch.sh:45-46,69`. |
| `<runtimeRoot>/trees/<tree>/harnesses` | dispatcher allowlist at `spec-cli/hooks/dispatch.sh:48-56` | stat/read | Missing with `harness-selection-v1` present makes every event exit 0 before handlers. |
| `<runtimeRoot>/trees/<tree>/hooks-manifest` | slot-first selection and dispatch loop at `spec-cli/hooks/dispatch.sh:58-69,77-104` | stat/read on every event | Missing falls back to `<runtimeRoot>/hooks-manifest`; if both are missing the event no-ops. Slot reads are `trace-excerpts.txt:11`; the old global fallback had zero accesses. |
| `<runtimeRoot>/sessions/<sid>/session.json` and `<runtimeRoot>/sessions/*/session.json` | direct/alias resolution is `spec-cli/hooks/harness.sh:135-155`; lifecycle gates then grep at `.spec/spexcode/.plugins/core/mark-active/mark-active.sh:35-39` and `.spec/spexcode/.plugins/core/stop-gate/stop-gate.sh:23-27` | failed stat/open/grep (`ENOENT`) | Absence is the expected self-launch discriminator: lifecycle handlers exit 0. It is still a real L05 path dependency and failed probes count. Wildcard/direct/grep evidence is `trace-excerpts.txt:13-15`. |
| `<runtimeRoot>/sessions/<sid>/` | universal spec hooks obtain it from `hp_store_dir`; `spec-first` creates it at `.spec/spexcode/.plugins/core/spec-first/spec-first.sh:15-17,39`, and `spec-of-file` reuses it at `.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:17-18,48-55` | failed probe, then directory create/read | If unwritable, the universal per-session dedupe state cannot persist; the hooks may repeat or fail to annotate consistently. The actual `mkdir -p` is `trace-excerpts.txt:16`. |
| `<runtimeRoot>/sessions/<sid>/spec-checked` | `spec-first` at `.spec/spexcode/.plugins/core/spec-first/spec-first.sh:17-18,39` | stat, create/write, later stat/read | Missing means the first governed read blocks and creates it; unwritable means the one-shot gate cannot become durable. The write is `trace-excerpts.txt:17`. |
| `<runtimeRoot>/sessions/<sid>/spec-of-file-seen` | `spec-of-file` at `.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:48-55` | stat, append/create | Missing is created on the first mutation; unwritable loses once-per-file dedupe. The append is `trace-excerpts.txt:18`. |
| `/tmp/.spex-hook-<dispatch-pid>.err` | dispatcher hard-codes the capture at `spec-cli/hooks/dispatch.sh:70-75`, writes it at `spec-cli/hooks/dispatch.sh:89`, reads on a block at `spec-cli/hooks/dispatch.sh:91-100` and removes it at `spec-cli/hooks/dispatch.sh:72` | create/truncate, possible read, unlink | Handler stderr capture/forwarding fails. `TMPDIR` does not relocate this path (`trace-excerpts.txt:19`). The safety boundary forbids sabotaging host `/tmp`; lane F needs an isolated mount namespace/container to test it. |
| governed source path named by payload and its `.spec/**/spec.md` ownership graph | `spec-first` extracts candidates and calls `spex internal spec-governors` at `.spec/spexcode/.plugins/core/spec-first/spec-first.sh:20-36`; `spec-of-file` calls `spex spec owner` at `.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:46-56` | read/directories | An uncovered path does not spend the read gate; a governed path cannot produce its owner/block text if the graph is unreadable. The individual graph reads remain in the external hash-pinned trace. |

### One-shot self-launch protocol commands

| Path on the fixture | Opener and source line | Access | Consequence if absent/unwritable |
|---|---|---|---|
| Explicit `<databasePath>` parent directory | locality probe at `packages/session-selflaunch/src/locality.ts:74-125`; protocol parent check at `packages/session-protocol/src/engine.ts:100-124` | stat/statfs | Missing parent fails loudly as `PROTOCOL_PATH_PARENT_MISSING`; it is never created as a fallback. |
| Explicit `<databasePath>` (`db/sessions.sqlite`) | CLI selects and opens it at `packages/session-selflaunch/src/cli.ts:124-145`; protocol opens SQLite after absolute-path validation | read/write/create | `initialize` creates it only when the parent exists; later commands fail loudly on incompatible/unreadable storage. The create/open is `trace-excerpts.txt:20`. |
| `<databasePath>-journal`; `<databasePath>-wal` probe | protocol fixes rollback journal DELETE at `packages/session-protocol/src/engine.ts:62-64`; each write is a transaction at `packages/session-protocol/src/engine.ts:227-243` | failed probe, journal create/write/unlink; WAL only failed probe | Journal failure makes the SQLite transaction fail. WAL absence is expected. A journal create/open is `trace-excerpts.txt:21`. |
| `packages/session-selflaunch/{bin/spex-session.mjs,dist/**}` and `packages/session-protocol/dist/**` | binary imports compiled CLI at `packages/session-selflaunch/bin/spex-session.mjs:1-3`; CLI dynamically imports protocol at `packages/session-selflaunch/src/cli.ts:106-121` | module read | The command cannot start/open protocol. |

No `pending.json`, timeline, cursor, watcher, legacy lock or revocation-marker path appeared in the canonical kernel
trace. No `prompt`, `launch`, PID/identity/rendezvous, generation ledger, files/web manifest, close ledger,
quarantine or create-candidate state path appeared either. Compiled modules that know those facilities were loaded by
the broad `spec-cli` composition; that is recorded under R05/R06, not misreported as a state-file consumer.

## G.1 row decisions

| ID | Decision | Self-launch evidence and last consumption point | Milestone disposition |
|---|---|---|---|
| L01 `pending.json` | **NO-CONSUMER** | `sendText` validates `readRecord` and rejects absence at `spec-cli/src/sessions.ts:4255-4264`; `acceptMessage` runs validation before `appendSent`/`enqueue` at `packages/session-core/src/message.ts:34-59`. The actual self-launch CLI uses protocol operations at `packages/session-selflaunch/src/cli.ts:143-164`. | No M4 deletion claim. Real governed readers/writers cut at M6; importer/package residue belongs to M7/M8. |
| L02 timeline send authority | **NO-CONSUMER** | The same validate-before-append ordering (`packages/session-core/src/message.ts:37-55`) prevents timeline append for a recordless target; the self-launch CLI never imports timeline code (`packages/session-selflaunch/src/cli.ts:1-5,118`). | M6 normal cut, M7 import, M8 codec residue. |
| L03 `cursors.json` | **NO-CONSUMER** | The entire self-launch command vocabulary is initialize/enqueue/dequeue/pending (`packages/session-selflaunch/src/cli.ts:11-25`); no follow/watch command exists. The live cursor consumer remains `spec-cli/src/session-follow.ts`, outside this scope. | M6 after Spex cursor policy; M8 residue. Nothing to delete in M4. |
| L04 watchers/parent | **NO-CONSUMER** | Self-launch has no topology command or governed record (`packages/session-selflaunch/src/cli.ts:11-25`); handler alias resolution reads only `session.json` at `spec-cli/hooks/harness.sh:135-155`. | Governed topology cut at M6, fallback/import residue M8. |
| L05 `session.json` / legacy session-directory shape | **CONSUMER** | `hp_store_dir` probes direct record and wildcard aliases at `spec-cli/hooks/harness.sh:135-155`; lifecycle handlers use absence as their no-op gate (`.spec/spexcode/.plugins/core/mark-active/mark-active.sh:35-39`, `.spec/spexcode/.plugins/core/stop-gate/stop-gate.sh:23-27`). Universal spec hooks then create/write the same `<runtimeRoot>/sessions/<sid>` directory (`.spec/spexcode/.plugins/core/spec-first/spec-first.sh:15-17,39`; `.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:17-18,48-55`). The last successful state writes are the two spec sentinels, not a record. | Not replaced by the M4 listener, so not M4-deletable. Governed record cut/import/codecs remain M6/M7/M8. |
| L06 `.delivery-locks` | **NO-CONSUMER** | Locks are entered only by old queue acceptance/drain (`packages/session-core/src/delivery-queue.ts:24-55,139-157`); L01 validation prevents acceptance and `spex-session` uses SQLite transactions instead (`packages/session-protocol/src/engine.ts:227-243`). | Governed cut M6, unused root/package residue M8. |
| L07 `.session-locks` | **NO-CONSUMER** for the named normal path | Hook no-op gates and universal sentinel writes are plain shell (`.spec/spexcode/.plugins/core/mark-active/mark-active.sh:35-39`; `.spec/spexcode/.plugins/core/spec-first/spec-first.sh:39`); the canonical selector is zero. A rejected `spex session send` is not the M4 producer and would acquire a record lock before its record validation (`packages/session-core/src/message.ts:37-39`), so this decision must not be generalized to that failed governed surface. | Split DB callers at M6; retain external-effect fences; delete an unused legacy root only at M8. |
| L08 store observer/poll correctness | **NO-CONSUMER** | `spex-session` performs one operation and closes at `packages/session-selflaunch/src/cli.ts:124-176`; dispatch performs one manifest pass and exits at `spec-cli/hooks/dispatch.sh:77-105`. No backend is launched. | Spex session-store observer correctness changes at M6; Git/project watching survives. |
| L09 mixed `runtime-session.ts` bridge | **NO-CONSUMER** semantically | Self-launch dynamically imports `@spexcode/session-protocol`, not the bridge (`packages/session-selflaunch/src/cli.ts:106-121`). The old module bytes are loaded as a root-export side effect, but no bridge function is called; R05/R06 record that packaging dependency. The repository has no production function importer. | M5 installed-adopter proof, M6 source/Spex cut, M8 package residue. |
| L10 `.revoked-senders` | **NO-CONSUMER** | The self-launch enqueue surface passes an optional sender as opaque protocol data (`packages/session-selflaunch/src/cli.ts:146-157`); it has no close/revocation command (`packages/session-selflaunch/src/cli.ts:11-25`). Old markers are only checked by old queue code (`packages/session-core/src/delivery-queue.ts:94-102,151-167`). | Governed race policy/cut M6, possible import M7, residue M8. |
| L11 dispatch receipts / settlement | **NO-CONSUMER** | Self-launch enqueue invokes protocol enqueue and dequeue ends protocol delivery (`packages/session-selflaunch/src/cli.ts:146-163`); there is no settlement command or handler-journal write. | Governed consumer journal cut M6, unresolved import M7, timeline encoding removal M8. |

## G.2 row decisions

| ID | Decision | Self-launch evidence and last consumption point | Milestone disposition |
|---|---|---|---|
| R01 prompt/launch artifacts | **NO-CONSUMER** | A user already launched this harness; dispatch receives payload stdin and runs handlers (`spec-cli/hooks/dispatch.sh:70-89`), while `spex-session` has no launch verb (`packages/session-selflaunch/src/cli.ts:11-25`). Loaded Spex modules do not constitute reads of these artifact paths. | Keep adapter-owned; M6 ownership move, M8 only obsolete formats. |
| R02 PID/identity/rendezvous/tmux sockets | **NO-CONSUMER** | Hook resolution uses payload id plus store lookup (`spec-cli/hooks/harness.sh:62-94,135-155`); the self-launch CLI accepts only protocol verbs/options (`packages/session-selflaunch/src/cli.ts:11-25`). | Keep adapter-owned; M8 removes only unstamped `/tmp` rendezvous fallback after old sessions drain. |
| R03 Codex generation state/lock | **NO-CONSUMER** | The direct Codex hook shim identifies the harness by baked argv (`spec-cli/hooks/dispatch.sh:19-28`); it never invokes the governed generation manager. Module loading is accounted by R06, but no generation state path was touched. | Remove its `session.json` bootstrap at M6; retain generation state/lock. |
| R04 config/root placement | **CONSUMER** | Materialize reads project config (`spec-cli/src/materialize.ts:243-249`; `.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:4`). Every dispatch derives `<runtimeRoot>` and `<treeSlot>` from Git plus `SPEXCODE_HOME` (`spec-cli/hooks/harness.sh:111-132`), then L05/spec sentinel paths from that root (`spec-cli/hooks/harness.sh:135-155`; `trace-excerpts.txt:13-18`). The explicit `spex-session --database-path` half avoids this locator (`packages/session-selflaunch/src/path.ts:27-64`), but does not replace hook state. | Not M4-deletable. Protocol placement assumptions cut under the real governed adopter at M6; timeline env/codecs at M8. Retain Spex adopter config. |
| R05 old `@spexcode/session-core` root/internal | **CONSUMER** | `spec-cli` declares and imports root/internal at `spec-cli/package.json:22-42` and `spec-cli/src/sessions.ts:15-16`; the materialize/handler-spawned CLI composition opens both compiled entries (`.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:2-3`). Last consumption point in this loop is the hook's `$SPEX internal ...` command (`.spec/spexcode/.plugins/core/spec-first/spec-first.sh:29-40` / `.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:55-63`). | Not M4-deletable without decoupling the hook CLI. Spex imports cut M6; package/release/lockfile residue M8. |
| R06 generated `dist` | **CONSUMER** | The CLI launcher executes `spec-cli/dist/cli.js` (`spec-cli/bin/spex.mjs:9-12`); `spex-session` imports its own dist (`packages/session-selflaunch/bin/spex-session.mjs:1-3`). Old session-core dist is also loaded under R05 (`.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:2-3`). | Retain active dist; regenerate after M6 and delete obsolete compiled/tarball members in M8. |
| R07 materialized config/plugins/per-tree manifest; global fallback | **CONSUMER** | Materialize writes shims and the slot manifest (`spec-cli/src/materialize.ts:227-237,284-345`); dispatch reads slot-first at `spec-cli/hooks/dispatch.sh:58-69`, observed at `.spec/spexcode/session-runtime/self-launch-inventory/evidence/trace-excerpts.txt:11-12`. The canonical run consumed the per-tree file; it did **not** access the legacy global fallback. | Retain materialization. Global fallback and stale generated copies are M8 after one-way rematerialization. |
| R08 `files.json` / `web.json` | **NO-CONSUMER** | No self-launch command exposes resource registration (`packages/session-selflaunch/src/cli.ts:11-25`), and record-gated hooks do not call those modules. Loading broad CLI module bytes is R06, not a manifest read. | Keep adopter resources; decouple record/lock scope at M6, no blanket protocol deletion. |
| R09 close ledger/quarantine/create candidates | **NO-CONSUMER** | The measured commands neither create/close governed sessions nor run repair (`packages/session-selflaunch/src/cli.ts:11-25`); hook scripts only read governance/spec state named above. | Keep lifecycle/audit/recovery facilities; M7 migration only if chosen, M8 only superseded formats. |

## M4 deletion proof selectors

There are **no M4-deletable rows**, so there is no honest S/G/T selector set to provide. Supplying selectors for
L01/L02/L03/L06 would manufacture a deletion proof for facilities self-launch never consumed; supplying one for
L05/R04/R05/R06/R07 would target still-live behavior that M4 has not replaced.

The selectors used to establish the narrower measured facts are retained for review, but are not deletion claims:

```text
S(state absence): pending\.json|timeline\.ndjson|session-cursors|watchers\.json|\.delivery-locks|\.session-locks|\.revoked-senders
G(package load):  @spexcode/session-core|session-core/internal|runtime-session|dist/(index|internal|runtime-session)\.js
T(state absence): /sessions/[^/]+/(pending\.json|timeline\.ndjson|timeline/|cursors\.json|watchers\.json)|/\.(delivery-locks|session-locks|revoked-senders)/
T(live paths):    /sessions/[^/]+/(session\.json|spec-checked|spec-of-file-seen)|/trees/[^/]+/(hooks-manifest|harnesses)|sessions\.sqlite
```

## Deletion-gate count discipline

The inventory run did not manufacture aggregate zeros. Lane F later satisfied all five prerequisites in run-7 and
measured the scoped M4 self-launch surfaces (`spikes/self-launch-sabotage/evidence/run-7/report.md:28-38`):

| Gate count | Inventory state at `ca51f4ca5` | Lane F run-7 final state |
|---|---|---|
| `static_legacy_imports` | `NOT-MEASURED(no aggregate production/test classification run)` | `MEASURED(0)` over all named self-launch source roots |
| `legacy_dist_files` | `NOT-MEASURED(no complete disposable clean-build inventory)` | `MEASURED(0)` after clean self-launch build |
| `legacy_tarball_files` | `NOT-MEASURED(no release-package inventory or npm-pack set)` | `MEASURED(0)` over the valid npm pack |
| `legacy_materialized_files` | `NOT-MEASURED(one project materialized, no complete target declaration)` | `MEASURED(0)` over real materialize output |
| `runtime_legacy_reads` | `MEASURED(0)` only for the named old state-path selector and canonical loop | `MEASURED(0)` after calibrated dispatch/dequeue exited zero |

No M4-scoped row remains `NOT-MEASURED` after run-7; its exact prerequisite/result lines are
`spikes/self-launch-sabotage/run-7.log:35-47`. This does **not** satisfy or advance the full M8 demolition gate:
run-7 also measured 15 retained live-shape accesses, and the M8 aggregate still needs its own complete source,
release, installed-project and runtime population.

## Sabotage targets for lane F

Every operation below must resolve below lane F's own fresh fixture before mutation.

| Exact target | Hostile operation | Expected result |
|---|---|---|
| `<runtimeRoot>/sessions/<sid>/session.json` | keep absent; repeat with valid but `governed:false` poison | New self-launch listener/CLI still initializes, dequeues and hands off from the explicit DB; lifecycle hooks remain silent. Any old message-state access is a failure. |
| `<runtimeRoot>/sessions/<sid>/{pending.json,timeline.ndjson,timeline/,cursors.json,watchers.json}` | create conflicting valid content, then make unreadable in separate fixtures | Self-launch FIFO output remains exactly the SQLite message and none of these paths is opened. |
| `<runtimeRoot>/{.delivery-locks,.session-locks,.revoked-senders}` | replace each with a mode-`000` regular file in separate fixtures | `spex-session initialize/enqueue/dequeue` and the listener pass; no attempted access is allowed. Do not extend this expectation to governed Git/harness operations that legitimately retain L07 fences. |
| `<runtimeRoot>/hooks-manifest` | remove | A freshly materialized event still dispatches through `<treeSlot>/hooks-manifest`; any global access is the R07 compatibility fallback and blocks an M8 claim. |
| `<treeSlot>/hooks-manifest` | remove while leaving `harness-selection-v1` and `<treeSlot>/harnesses` | Current dispatch exits 0 with no handler (`spec-cli/hooks/dispatch.sh:66-69`); this is a retained dependency proof, not a passing listener test. Rematerialize must restore it. |
| `<treeSlot>/harnesses` | remove while keeping `<runtimeRoot>/harness-selection-v1` | Dispatch is intentionally inert (`spec-cli/hooks/dispatch.sh:51-56`); proves the allowlist is retained. |
| `<treeSlot>/content-hash` and `<treeSlot>/plugin-folders` | remove before rematerialize | Materialize recreates them (`spec-cli/src/materialize.ts:353-371,409-415`); hook runtime behavior after successful rematerialize is unchanged. |
| `<runtimeRoot>/sessions/<sid>/spec-checked` | remove, then fire a governed read twice | First event blocks and recreates it; second passes (`.spec/spexcode/.plugins/core/spec-first/spec-first.sh:17-18,37-43`). Making the directory unwritable should expose a non-durable/repeating gate and must not be described as listener failure. |
| `<runtimeRoot>/sessions/<sid>/spec-of-file-seen` | remove, then fire the same mutation twice | First event appends the path; second dedupes (`.spec/spexcode/.plugins/core/spec-of-file/spec-of-file.sh:48-56`). This is retained universal spec behavior. |
| Explicit `<databasePath>` | absent file with existing parent; then read-only/corrupt file in separate fixtures | `initialize` may create the absent DB; read-only/corrupt storage fails loudly. No fallback to Git/project store or old queue is allowed (`packages/session-selflaunch/src/cli.ts:129-176`). |
| Explicit `<databasePath>` parent | remove | Fail `PROTOCOL_PATH_PARENT_MISSING` with repair text; do not create or fall back (`packages/session-selflaunch/src/locality.ts:92-100`; `packages/session-selflaunch/src/cli.ts:167-174`). |
| `$SPEX_SESSION_CLI` target / `PATH` `spex-session` | configure a DB, then point the executable seam at an absent/non-executable file | The M4 listener must fail loudly with the repair entrypoint. With no protocol DB configured it must remain inert, per `docs/session-platform-m4-self-launch-cutover.md:34-38`. |
| `/tmp/.spex-hook-<pid>.err` | **NOT AUTHORIZED on the host** | The path is hard-coded at `spec-cli/hooks/dispatch.sh:70-75`; only a disposable mount namespace/container may make its `/tmp` hostile. Expected consequence is a loud dispatch failure, never mutation of host `/tmp`. |

Lane F should keep positive proof and hostile proof in the same scenario. A sabotage pass may prove adoption, but it
does not change this inventory's deletion ownership and cannot turn the empty M4 delete list into completed work.
