# Session legacy sabotage and deletion gate

Status: executable M0/M8 audit baseline at integration head `6ea863b22`. This document does not authorize a
production cutover and does not change the frozen protocol principles.

## Safety and path vocabulary

Every destructive-looking step below runs only after creating `fixture=$(mktemp -d)` and pointing
`SPEXCODE_HOME`, `TMPDIR`, the project checkout and any database path into that fixture. Never run the steps
against the live store, never close/archive a real session, and never remove a real worktree or session record.

The current path derivation is:

- `<home>` = `${SPEXCODE_HOME:-$HOME/.spexcode}` (`packages/spec-core/src/project-store.ts:7`).
- `<runtimeRoot>` = `<home>/projects/<encoded absolute git-common-dir parent>`
  (`packages/spec-core/src/project-store.ts:14`, `packages/spec-core/src/layout.ts:237`).
- `<sessionStore>` = `<runtimeRoot>/sessions/<sessionId>` (`packages/spec-core/src/layout.ts:255-257`).
- `<treeSlot>` = `<runtimeRoot>/trees/<encoded worktree>` (`packages/spec-core/src/layout.ts:251`).

Before any scenario, copy only the needed fixture data into that layout and prove all resolved paths start with
the printed `fixture` path. A scenario aborts if `realpath` escapes it.

## Executable gate and measurement contract

Run:

```bash
spikes/legacy-sabotage/gate.sh
```

The default runtime surface is the real read-only `env SPEXCODE_API_URL= spex session ls --json`. A different
real surface can be traced without changing the counting code:

```bash
spikes/legacy-sabotage/gate.sh -- spex session show <sessionId> --json
```

For M8, pass every packed release and every installed project root:

```bash
LEGACY_GATE_BUILD_ROOT='<disposable-clean-built-checkout>' \
LEGACY_GATE_TARBALLS='<protocol.tgz>:<cli.tgz>' \
LEGACY_GATE_MATERIALIZED_ROOTS='<project-a>/.codex:<project-a>/.claude:<project-b>/.opencode' \
spikes/legacy-sabotage/gate.sh -- <real-product-command> <args...>
```

The gate prints five independent blocking counts. G.5 #11 is implemented by refusing to infer any shipped-copy
result from source alone:

- `static_legacy_imports`: line references in production `package.json`, lockfile, `packages/`, `spec-cli/` and
  `scripts/` to the old package/modules, paths, lock roots, env alias and compatibility branches. `*.test.*`,
  `test/`, `tests/`, `fixtures/`, `compat/` and `*.fixture` matches are reported as
  `test_only_legacy_evidence` but excluded. Comments in production files count: a deletion claim should not leave
  current production narration or a string-based fallback naming the old mechanism. Prerequisite: all named source
  roots exist; otherwise the value is `NOT-MEASURED` and exit is 2.
- `legacy_dist_files`: distinct matching files below every `dist` in `LEGACY_GATE_BUILD_ROOT`, excluding
  `node_modules`. Prerequisite: an explicit disposable build root with the five expected workspace entrypoints
  produced by a clean root build (`spikes/legacy-sabotage/gate.sh:62-95`); absent or partial build output is
  `NOT-MEASURED`, never zero.
- `legacy_tarball_files`: distinct matching members after unpacking every explicitly supplied
  `LEGACY_GATE_TARBALLS` item. Prerequisite: at least one readable, valid `npm pack` tarball and the M8 caller's
  complete release-package inventory (`spikes/legacy-sabotage/gate.sh:97-133`); missing, invalid or non-npm-pack
  layout input is
  `NOT-MEASURED` and exit 2.
- `legacy_materialized_files`: distinct matching executable hook/plugin/settings files in every explicitly supplied
  `.claude`, `.codex`, `.opencode` or `.pi` root. Skill/command prose is excluded because it is evidence/config,
  not a runtime consumer. Prerequisite: rematerialization has run, all target roots are named and at least one
  eligible file exists (`spikes/legacy-sabotage/gate.sh:135-173`); otherwise the result is `NOT-MEASURED` and
  exit 2.
- `runtime_legacy_reads`: every `%file` syscall line naming a legacy runtime path, including failed probes. An
  `ENOENT` fallback attempt is still a legacy access and must fail the gate. Prerequisite: `/usr/bin/strace` exists
  and the traced public command exits zero; otherwise the result is `NOT-MEASURED` and exit 2.

Every count has a sibling `*_prerequisite=MEASURED(none)` line. Any `NOT-MEASURED(<reason>)` is a gate failure,
even when all measured counts happen to be zero. No combined generated count exists: dist, tarball and materialized
copies can fail independently.

For a row-specific audit, use the selector named below with these commands in addition to the aggregate gate:

```bash
# S: production static references; the aggregate gate performs the test-only classification.
rg -n '<STATIC_SELECTOR>' package.json package-lock.json packages spec-cli scripts \
  -g '*.{ts,tsx,js,mjs,cjs,sh,json}' -g '!**/dist/**'

# G: generated and shipped members. Run after clean build, pack and materialize.
find . -type f \( -path '*/dist/*' -o -path '*/.codex/*' -o -path '*/.claude/*' \
  -o -path '*/.opencode/*' -o -path '*/.pi/*' \) -print0 | xargs -0 rg -l '<GENERATED_SELECTOR>'
tar -xOf <package.tgz> | rg -n '<GENERATED_SELECTOR>'

# T: kernel trace for the row's named real product surface. Failed path probes also count.
/usr/bin/strace -f -qq -e trace=%file -s 4096 -o <trace.log> -- <surface> <args...>
rg -n '<RUNTIME_PATH_SELECTOR>' <trace.log>
```

The final assertion is zero output from S and each independent G surface, zero matches from T, five measured zero
counts and no unmet prerequisite. Test-only imports may remain as proof that the removed boundary stays absent.

## Runtime file-access trace decision

The selected mechanism is `/usr/bin/strace -f -e trace=%file` around a process started by the gate.
`/proc/sys/kernel/yama/ptrace_scope` is `1`: attaching an unrelated backend is unavailable, but tracing the
command and all descendants it launches works. `-f` is essential because the installed `spex` launcher, shell
hooks, compiled CLI and adapter subprocesses do not remain in one Node process.

Alternatives have narrower or unavailable coverage:

| Mechanism | Covers | Misses / decision |
| --- | --- | --- |
| `strace -f` | Node `fs`, compiled `dist`, native addons that make file syscalls, shell hooks and descendant processes | Cannot attach an already-running unrelated backend at ptrace scope 1. Launch the backend/surface as the traced descendant. Selected. |
| `bpftrace` open/openat probes | Kernel-wide processes, including a pre-existing backend | Local probe exited 1 with `ERROR: bpftrace currently only supports running as the root user.` It is not an ordinary reviewer/CI gate here. |
| Node `--import` patch of `node:fs` | JavaScript calls in one patched Node realm; source and `dist` if they execute in that realm | Misses shell hooks, uninstrumented children, native direct syscalls and already-captured named `fs` exports unless builtin bindings are synchronized. Propagating `NODE_OPTIONS` changes child behavior. Useful diagnosis, not the deletion gate. |

The mechanism was proved twice. A live read-only `spex session ls --json` trace successfully opened current
`session.json` files. A disposable store copy was then served by the real HTTP backend; `GET
/api/sessions/<id>`, `GET /api/sessions/<id>/timeline` and its delivery sweep produced successful `openat` calls
for all three required classes:

```text
.../sessions/bbb98193-.../session.json                         O_RDONLY = 24
.../sessions/bbb98193-.../pending.json                         O_RDONLY = 27
.../sessions/bbb98193-.../timeline/000000000001.ndjson         O_RDONLY = 22
```

The exact captured lines and counts are in `spikes/legacy-sabotage/trace-proof.log`. This proves the tracer can
see today's legacy reads; a zero at M8 will not be a tracer that was blind from the start.

## G.1 sabotage scripts

### L01 - `pending.json`

- **Sabotage:** in the copied store, rename `<sessionStore>/pending.json` to `pending.json.poison`, create a
  read-only `<runtimeRoot>/.delivery-locks`, and repeat once with valid but conflicting pending JSON. The path and
  reader are `packages/session-core/src/delivery-queue.ts:20,58-74`; immediate and recovery consumers are
  `spec-cli/src/sessions.ts:4191-4236,1779-1791`.
- **Positive proof:** send A then B through `spex session send`, then through `POST /api/sessions/:id/input` and
  dashboard compose; discard the wake, start/restart the traced backend, and observe exactly A then B once at the
  real adapter input.
- **Deletion evidence:** S/G selector `pending\.json|delivery-queue|\.delivery-locks`; T selector
  `/sessions/[^/]+/pending\.json|/\.delivery-locks/` over CLI send, HTTP send and restart reconciliation.

### L02 - timeline files

- **Sabotage:** replace copied `<sessionStore>/timeline.ndjson` and every
  `<sessionStore>/timeline/<12-digit>.ndjson` with syntactically valid conflicting events while the new DB fixture
  remains authoritative. Paths/readers are `packages/session-core/src/session-timeline.ts:33-58,91-111,140-172`.
- **Positive proof:** read dashboard conversation via `GET /api/sessions/:id/timeline`
  (`spec-cli/src/index.ts:529-535`), run `spex session wait`/`watch stream`
  (`spec-cli/src/session-follow.ts:107,127`), and exercise a real prompt transition/execution binding. All output
  must equal DB history and keyed replay must not duplicate the product operation.
- **Deletion evidence:** S/G selector `timeline\.ndjson|session-timeline|dispatch-settled`; T selector
  `/sessions/[^/]+/(timeline\.ndjson|timeline/)` over timeline HTTP, wait/watch, resume and keyed input.

### L03 - `cursors.json`

- **Sabotage:** in separate fixture runs remove, chmod `000`, truncate, and write an out-of-range but valid cursor
  map at `<sessionStore>/cursors.json`. The codec is `packages/session-core/src/session-cursors.ts:15-45`; the live
  consumer is `spec-cli/src/session-follow.ts:70-108,161-170`.
- **Positive proof:** start `spex session wait <target> --timeout ...` or `spex session watch stream`, terminate
  and restart the consumer, then prove the M1-selected contract: no missed event for durable cursors, or bounded
  replay with no loss for explicit at-least-once cursors.
- **Deletion evidence:** S/G selector `cursors\.json|session-cursors|followCursor|advanceFollow`; T selector
  `/sessions/[^/]+/cursors\.json` over first run and restarted wait/watch.

### L04 - watchers plus parent fallback

- **Sabotage:** write a valid copied `<targetStore>/watchers.json` pointing to watcher X while the DB topology
  points to Y; set copied `session.json.parent` to Z. The current file path is
  `spec-cli/src/sessions.ts:475-508` and the second bridge implementation is
  `packages/session-core/src/runtime-session.ts:86,175`.
- **Positive proof:** use `spex session watch/list/cancel`, `spex session new --parent`, `spex session reparent`,
  then declare a lifecycle transition. Routing and notification must follow only DB edges after all wake hints are
  dropped and the backend restarts.
- **Deletion evidence:** S/G selector `watchers\.json|readWatchEntries|session\.json.*parent|runtime-session`; T
  selector `/sessions/[^/]+/(watchers\.json|session\.json)` over watch/reparent/lifecycle surfaces.

### L05 - monolithic `session.json`

- **Sabotage:** after importing the copied fixture, rename `<runtimeRoot>/sessions` and repeat with each copied
  `session.json` chmod `000`. The canonical path is `packages/spec-core/src/layout.ts:255-257`; shell lookup is
  duplicated at `spec-cli/hooks/harness.sh:148-154`, and governed record reads begin in
  `spec-cli/src/sessions.ts:431`.
- **Positive proof:** from the explicit DB, run `spex session ls/show/send`, lifecycle declarations, dashboard
  graph/detail, real hooks, eval/resource lookup and backend restart. Compare the importer count/id/hash manifest
  before sabotage.
- **Deletion evidence:** S/G selector `session\.json|sessionRecordPath|readRecord`; T selector
  `/sessions/[^/]+/session\.json` over CLI, dashboard/API, hooks, eval/resources and restart.

### L06 - delivery lock root

- **Sabotage:** make copied `<runtimeRoot>/.delivery-locks` a mode-`000` file (not a directory) and run concurrent
  producers/consumers. Current creation and PID reclaim are
  `packages/session-core/src/delivery-queue.ts:29-48,139-190`.
- **Positive proof:** send fixed keyed A/B from two CLI/API producers while two adopter runtimes dequeue; kill one
  consumer around dequeue. FIFO, idempotent replay and reconciliation must hold without duplicate adapter input.
- **Deletion evidence:** S/G selector `\.delivery-locks|withDeliveryLocks|delivery-queue`; T selector
  `/\.delivery-locks/` over the concurrent public producer/runtime suite.

### L07 - record lock root

- **Sabotage:** for DB-only message/lifecycle/topology fixtures, make `<runtimeRoot>/.session-locks` unavailable.
  Separately make only each proposed named replacement fence hostile in its own temporary scenario. The legacy root
  is `packages/session-core/src/record-lock.ts:5`; unlike callers include reparent
  (`spec-cli/src/sessions.ts:749`), create/worktree (`:2222,2437`), launch proof (`:2603`), stop/archive/close
  (`:3452,3562,3781`) and files/web manifests.
- **Positive proof:** DB message/topology/lifecycle operations pass without the old root. Concurrent real
  `spex session new`, resume/launch/stop and `session files/web add/list/retract` pass only under their own named
  Git, harness and resource fences.
- **Deletion evidence:** S/G selector `\.session-locks|withSessionRecordLock|withRecordLock`; T selector
  `/\.session-locks/` across DB-only operations and the three named-fence product suites. The old root cannot be
  zeroed by a queue-only test.

### L08 - session-store observer correctness

- **Sabotage:** set `SPEXCODE_DISABLE_WATCHERS=store` for the disposable backend and discard every communication
  wake. The store watcher is `spec-cli/src/graphStream.ts:465-475`; the accountable cold patrol is
  `spec-cli/src/graphStream.ts:1005-1016`; delivery polling is `spec-cli/src/sessions.ts:1779-1791`.
- **Positive proof:** offline enqueue is found by DB reconciliation after restart. Independently mutate adopter DB
  lifecycle/topology through CLI/API and keep a real `/api/graph/stream` dashboard subscriber open until the graph
  updates through the DB revision signal/patrol.
- **Deletion evidence:** S/G selector `storeWatcher|SPEXCODE_DISABLE_WATCHERS|superviseDelivery`; T selector for
  old session-store files over backend startup, lost-wake recovery and graph SSE. Git/project watcher accesses are
  explicitly not matched.

### L09 - mixed runtime bridge

- **Sabotage:** `npm pack`, install into a clean temporary consumer, and attempt the old root bridge imports after
  making all Spex config/store paths unavailable. The bridge is exported at
  `packages/session-core/src/index.ts:4-14` and implemented at
  `packages/session-core/src/runtime-session.ts:1-239`; current production search finds no importer.
- **Positive proof:** the installed consumer initializes, projects lifecycle in its adopter layer, mutates topology,
  notifies and dequeues through split public owners. Importing old bridge symbols or the module must fail.
- **Deletion evidence:** S/G selector `runtime-session|registerRuntimeSession|publishRuntimeSessionState`; T selector
  for every legacy session file/lock during the installed consumer workflow; tarball member search must be zero.

### L10 - sender revocation markers

- **Sabotage:** omit and then make `<runtimeRoot>/.revoked-senders` read-only in a copied close/send race fixture.
  The marker path/read is `packages/session-core/src/delivery-queue.ts:21-22,97-102,163-167`; close currently writes
  it from `spec-cli/src/sessions.ts:3726`.
- **Positive proof:** through the lifecycle close authorization and real recipient delivery loop, stale debt from
  the closed sender is never delivered, the racing send has one serial outcome, and a later valid sender is not
  suppressed.
- **Deletion evidence:** S/G selector `\.revoked-senders|revokeSenderDelivery|senderDeliveryRevoked`; T selector
  `/\.revoked-senders/` over the close/send race and restart sweep.

### L11 - private dispatch receipts and settlement

- **Sabotage:** poison only copied legacy timeline receipt/`dispatch-settled` rows, then kill the disposable adopter
  before dequeue commit, after commit/before adapter call, and after adapter success/before handler-journal commit.
  Readers/writers are `packages/session-core/src/session-timeline.ts:140-165` and
  `packages/session-core/src/delivery-queue.ts:171-180`.
- **Positive proof:** replay the same keyed `POST /api/sessions/:id/input`/dashboard operation. The stated consumer
  journal contract decides whether the downstream operation is retried; no silent duplicate and no timeline
  consultation is allowed.
- **Deletion evidence:** S/G selector `sentDispatchReceipt|settleSentDispatch|dispatch-settled`; T selector for
  legacy timeline paths over every crash/replay boundary.

## G.2 sabotage scripts

### R01 - prompt and launch artifacts

- **Sabotage:** keep copied `<sessionStore>/prompt`, `launch`, `launch.sh` and `launch.proof`, while poisoning all
  L01-L11 communication files. In the inverse clean protocol consumer, omit the launch artifacts entirely. Current
  paths are `spec-cli/src/sessions.ts:159-179,1464,2837-2883`.
- **Positive proof:** real `spex session new`, `show`, `resume` and `stop` must launch/control the harness in the
  Spex fixture; the clean protocol consumer must enqueue/dequeue with no harness artifacts.
- **Deletion evidence:** these artifacts are retained, so S/G/T must target only obsolete format names and any
  protocol import of `prompt|launch|launch\.proof`, not blanket path existence.

### R02 - PID, identity, rendezvous and native sockets

- **Sabotage:** set `TMPDIR=<fixture>/tmp`, create a conflicting unstamped
  `<TMPDIR>/spexcode-rv-<sessionId>.sock`, and provide the correct stamped `<sessionStore>/rv.path`. Current fallback
  and stamp are `spec-cli/src/harness.ts:417,436`; PID consumers include `spec-cli/src/harness.ts:579` and
  `spec-cli/src/host-resources.ts:325`.
- **Positive proof:** real harness delivery, `spex session resources`, liveness, `stop` and unload proof use the
  stamped socket and exact PID identity. With protocol storage unavailable, native control still works.
- **Deletion evidence:** retain stamped PID/identity/socket formats. S/G selector for removal is
  `legacyRvSock|spexcode-rv-`; T selector `/tmp/spexcode-rv-.*\.sock`. Trace also proves retained stamped paths are
  still used.

### R03 - Codex app-server generations

- **Sabotage:** chmod copied `session.json` unreadable while retaining
  `<runtimeRoot>/codex-app-server-generations.json`, its lock, generation PID/receipt/log/socket and adopter DB rows.
  The ledger is `spec-cli/src/codex-runtime-generations.ts:30`; legacy bootstrap reads are at `:307,321`.
- **Positive proof:** through real Codex `session new/resume/stop`, start and reuse multiple generations, bind the
  correct thread and clean them up without a session-record bootstrap.
- **Deletion evidence:** S/G selector only `codex-runtime-generations.*session\.json|join\(.*session\.json`; T
  selector `/sessions/[^/]+/session\.json`. Generation ledger/lock/socket matches are retained and must not count.

### R04 - config and placement assumptions

- **Sabotage:** from an unrelated copied cwd and custom `SPEXCODE_HOME`, inject the old timeline env alias and
  conflicting `.spec/spexcode.json`/`.spec/spexcode.local.json`, then open two explicit absolute DB paths in one process.
  Current home/project derivation is `packages/spec-core/src/project-store.ts:7-17`; config merge is
  `packages/spec-core/src/layout.ts:107-113`; the shell mirror is `spec-cli/hooks/harness.sh:111-119`; the old env
  is `packages/session-core/src/session-timeline.ts:61-63`.
- **Positive proof:** protocol operations affect only the passed DB; old aliases are rejected, not ignored into a
  fallback. Ordinary `spex session ls` still resolves adopter configuration from the copied project.
- **Deletion evidence:** S/G selector `SPEXCODE_TIMELINE_SEGMENT_BYTES|gitCommonDir|spexcode\.local?\.json` within
  the protocol package/tarball; T selector for Git/config/session paths during the clean protocol consumer. Spex
  adopter config reads remain allowed outside protocol.

### R05 - old package, internal export and wildcard re-export

- **Sabotage:** pack/install into a clean temp consumer with no workspace resolution. Import only the new public
  package, then assert `@spexcode/session-core`, its `/internal`, runtime bridge and Spex wildcard path fail. Current
  package rows are `packages/session-core/package.json:2-13`, production imports are
  `spec-cli/src/sessions.ts:15-16`, and wildcard export is `spec-cli/src/session-timeline.ts:2-4`.
- **Positive proof:** invoke every new installed public operation; `npm ls --all` contains no `spec-core` beneath
  protocol and no monorepo/source fallback.
- **Deletion evidence:** S/G selector `@spexcode/session-core|session-core/internal|export \*`; runtime module-load
  trace and unpacked tarball search both zero for the old package/subpath.

### R06 - generated `dist`

- **Sabotage:** create a disposable checkout with `git archive`, inject a stale compiled module and old path string
  under its copied `dist`, and first prove G reports it. Then clean-build there, pack, install and run the public
  APIs; the stale member must be gone rather than merely shadowed. Do not build only the TypeScript tree and call
  deletion complete. Atomic dist replacement is `scripts/build-dist.mjs:25-40`.
- **Positive proof:** the installed CLI and package surfaces pass from `dist`, not source.
- **Deletion evidence:** run G across every `dist` and unpacked tarball using the full aggregate selector; run T on
  the installed consumer. Any old module, export, path string or hook asset is a blocking generated file.

### R07 - materialized hooks and global manifest fallback

- **Sabotage:** in copied project fixtures run `spex materialize`, remove
  `<runtimeRoot>/hooks-manifest`, poison old session paths and dispatch one real hook event per supported harness.
  Slot-first/global-fallback resolution is `spec-cli/hooks/dispatch.sh:66-69`; doctor mirrors it at
  `spec-cli/src/doctor.ts:413-419`.
- **Positive proof:** installed `spex doctor contract`, materialize and actual hook dispatch succeed using only the
  `<treeSlot>` manifest and new session authority. A pre-slot copy must be explicitly re-materialized before cutover.
- **Deletion evidence:** S/G selector `runtime_root.*hooks-manifest|runtimeRoot\(.*hooks-manifest|session\.json`
  across source hooks, packed assets and materialized executable files; T selector `/hooks-manifest|session\.json`
  over real hook processes. The per-tree slot manifest itself is retained.

### R08 - files/web resource manifests

- **Sabotage:** keep copied `<sessionStore>/files.json` and `web.json` while all communication legacy paths are
  absent. Paths are `spec-cli/src/session-files.ts:22` and `spec-cli/src/session-web.ts:18-23`; they currently share
  record existence/locking rather than protocol state.
- **Positive proof:** real `spex session files/web add/list/retract`, dashboard files view/download and web proxy
  continue to work; a clean protocol consumer never reads either manifest.
- **Deletion evidence:** do not include `files\.json|web\.json` in the legacy aggregate. S removes their imports of
  record/queue locks; T requires zero legacy communication/record paths while separately proving the retained
  manifest accesses occur.

### R09 - close ledger, quarantine and create candidates

- **Sabotage:** with communication legacy paths absent in a copied Git/store fixture, exercise close-history lookup,
  corrupt-record recovery and concurrent same-branch create. Paths are
  `spec-cli/src/sessions.ts:108-154` (`session-close-ledger.ndjson`), `:2220,2437`
  (`.session-create-candidates`) and `:3799,3894-3939` (quarantine).
- **Positive proof:** `spex session ls <closed-id>`, quarantine/repair API and concurrent `spex session new` retain
  their product facts and external-effect fencing. No real session close/archive is part of this audit run.
- **Deletion evidence:** these facilities are retained unless independently superseded. S targets only imports of
  legacy queue/record codecs; T requires zero L01-L11 paths while proving ledger/candidate/quarantine paths remain
  reachable through their named product surfaces.

## G.5 deletion-blocking corrections

### M6/M7 executable order

The runnable order is:

1. Before M6, freeze the isolated importer, its legacy codecs and equality verifier. Prove it on copied dirty
   stores, including count, id, FIFO order, payload hash, topology, cursor decision, unresolved handler work and
   tombstones.
2. M6 atomically cuts every normal-runtime reader/writer. The isolated importer remains in a separately invokable
   migration artifact and is absent from the normal package/import graph. The M6 gate requires normal-runtime
   static/trace zero but deliberately cannot claim full demolition while that artifact exists.
3. M7 stops old writers, checkpoints, invokes that already-proved importer once, verifies equality, moves the old
   root out of the runtime path and starts only the new release.
4. M8/rollback-window close deletes the importer codecs and artifact. Only here may the unscoped aggregate gate,
   tarball scan and runtime traces all reach zero.

Thus M6 is blocked if the importer/equality proof does not already pass; M8 is blocked while any importer codec or
legacy archive reader remains in shipped/runtime packages.

### Record-lock split

At M6, callers that mutate only message, lifecycle or topology rows move to bounded SQLite transactions: watcher
subscription/settlement/reparent, governed record state, close/sender revocation and all pending/timeline work.
SQLite does not fence external effects. Retain distinct named fences:

- `git-worktree-create:<hash(path,branch)>` for candidate reservation, Git worktree/branch creation and matching
  close cleanup (`spec-cli/src/sessions.ts:2222,2437,3776`).
- `harness-runtime:<sessionId>` for launch/resume, `launch.proof`, PID/identity/socket publication, stop and unload
  (`spec-cli/src/sessions.ts:2603,2757,3452`).
- `resource-manifest:<sessionId>` for atomic files/web manifest rewrites, unless those manifests independently move
  to an adopter DB.
- `quarantine:<sessionId>` for opaque record move/restore while that lifecycle facility exists.

These fences need their own roots and ownership names; they are not aliases for `.session-locks`. The old root is
deletable only when static caller classification is complete, each external-effect concurrency YATU passes, and T
shows no `.session-locks` access. The new named fence roots remain.

### Observer boundary

Delete the session-store `fs.watch` registration and every claim that it or a wake hint makes communication
correct. Retain Git refs/index/worktree/spec/project watchers because their authorities are still files. Dashboard
graph freshness gets an adopter DB revision/commit signal for latency plus a bounded revision requery/patrol for
cross-process convergence; the graph is rebuilt from DB facts, never from the hint. The gate therefore blocks old
session-store paths and `storeWatcher`, not `TreeWatcherRegistry` as a class or all graph watchers.

### Live compatibility paths

- **Unstamped `rvSock`:** migration inventory must show every controllable live session has a verified `rv.path`;
  old live sessions are drained or explicitly relaunched before the gate. Sabotage conflicting `TMPDIR` fallback,
  then M8 requires `legacyRvSock|spexcode-rv-` absent from source/dist/tarball and no `/tmp/spexcode-rv-*` trace.
- **Global pre-slot hook manifest:** inventory every active checkout/worktree and rematerialize it to a tree slot;
  record the slot/hash and run real hook events. M8 removes both dispatch and doctor fallback branches, scans packed
  and materialized copies, and traces no `<runtimeRoot>/hooks-manifest`. Slot manifests remain.

### Generated and shipped copies

This is the executable G.5 #11 hard gate. Source zero is insufficient and cannot stand in for any generated
surface. M8 must clean-build in a disposable checkout, pack every release package with `npm pack`, unpack and scan
those tarballs, install them into a clean consumer, rematerialize real project plugins, then trace installed public
APIs and real hook events. `LEGACY_GATE_BUILD_ROOT`, `LEGACY_GATE_TARBALLS` and
`LEGACY_GATE_MATERIALIZED_ROOTS` are mandatory evidence inputs. The gate reports source, dist, tarball and
materialized counts separately; a missing prerequisite prints `NOT-MEASURED` and exits 2 instead of rendering 0.

## Not legacy: deletion deny-list

- **Artifacts, files/web evidence and large-file references:** retain when they are user evidence or artifact-store
  metadata and do not import protocol codecs. Deleting them loses inspectable proof and breaks dashboard
  download/proxy surfaces.
- **Harness-discovered materialized hooks, contracts, skills and commands:** retain the current generated copy when
  it is selected by harness discovery and contains no old session lookup/fallback. Deleting it launches an
  ungoverned harness with missing lifecycle controls.
- **Native launch proof, PID, socket, endpoint and unload proof:** retain when owned and validated by the harness
  runtime adapter rather than used as communication authority. Deleting it makes exact-process liveness, steering,
  stop and unload unprovable or risks signaling the wrong process.
- **Spex lifecycle/worktree/branch/proposal facts:** move to adopter-owned schema and retain their semantics; reject
  any attempt to put them in protocol rows. Deleting them breaks governance, merge/close decisions and Git/worktree
  ownership even if message delivery still works.

## Fail-first baseline

The original first executable run is retained byte-for-byte at `spikes/legacy-sabotage/fail-first.log` (17,000
bytes, SHA-256 `c339db23cca676222ff6e887c1c7e0fdfd5d212387eadad5d0181f9e8811d5e7`). It exited 1:

```text
static_legacy_imports=94
legacy_generated_files=0
runtime_legacy_reads=21
legacy gate: FAIL (all three counts must be zero)
```

The middle value is historical evidence of a gate defect, not a clean baseline: that version found no `dist` tree
and silently rendered “not measured” as 0. The file is intentionally not corrected or deleted. The fixed gate's
first no-prerequisite run is preserved separately as `fail-first-v2.{command,stdout,stderr,exit}`. It measured
`static_legacy_imports=94` and `runtime_legacy_reads=22`, printed `NOT-MEASURED` independently for dist, tarball and
materialized, and exited 2 with its own prerequisite assertion.

The complete built baseline is `measured-baseline-v2/`, produced from a disposable clone pinned to full SHA
`6ea863b228188cb047904dcbecee9dc5888b912a` by `measure-built-baseline.sh`. After `npm ci`, root build, real
`npm pack` for all five published workspaces, real `spex materialize` and a traced compiled CLI command, all
prerequisites were measured:

```text
static_legacy_imports=94
legacy_dist_files=29
legacy_tarball_files=40
legacy_materialized_files=0
runtime_legacy_reads=2
legacy gate: FAIL (all measured legacy counts must be zero)
```

Exit 1 is the required fail-first baseline: it comes from the gate's legacy-count assertion, not an absent module,
bad path or failing product command. The materialized zero is measured: `spex materialize` completed, an eligible
materialized settings surface existed and its independent prerequisite line is `MEASURED(none)`.
`measured-baseline-v1/` is retained as the earlier partial-inventory run that packed only session-core and spec-cli;
it is not the canonical baseline and is not used for closure.

## Gate mutation proof

The canonical self-test command is:

```bash
env PATH=/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin:/usr/bin:/bin \
  LEGACY_GATE_NODE_BIN=/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/node \
  LEGACY_GATE_NPM_BIN=/home/jeffry/.local/node-dist/node-v24.15.0-linux-x64/bin/npm \
  /usr/bin/bash spikes/legacy-sabotage/self-test.sh \
  /tmp/spex-legacy-self-test-evidence-$$-$RANDOM
```

It starts with no `dist`, executes the fixture's clean build, runs `npm pack`, materializes `.codex/hooks.json`,
then proves that clean source/dist/tarball/materialized/runtime surfaces are all measured zero and PASS. It is the
complete before/after command for every vector: `self-test.sh:33-110` creates the clean-before fixture and five
one-change copies, and `:57-70` records and runs the exact `env -C` gate commands. The runtime after-command carries
the explicit Node binary, script and `session.json` argument at `:109-110`; the other vectors deliberately trace
`/bin/true` so only their static or shipped-copy mutation can fail. All mutated copies live below the script's
`mktemp -d` root and are removed on exit (`:30-31`).

The retained canonical run is `self-test-evidence-v10/`. Each vector keeps its first raw `*.command`, `*.stdout`,
`*.stderr` and numeric `*.exit`; the commands show every prerequisite env and exact child arguments. Re-run the
complete command above with a fresh evidence pathname to reproduce the pass log without reusing or overwriting any
original evidence.

| Vector | Source-backed mutation | Why it is minimal | Observed assertion |
| --- | --- | --- | --- |
| Static | `spikes/legacy-sabotage/fixtures/static-legacy-consumer.ts:1`, copied only to `spec-cli/src/consumer.ts` by `spikes/legacy-sabotage/self-test.sh:80-83` | Adds one production-source `session.json` reference after all four other surfaces are clean. | `static_legacy_imports=1`, other four 0, exit 1. |
| Dist | `spikes/legacy-sabotage/fixtures/generated-hook.sh:2`, copied only to already-built `spec-cli/dist/legacy-hook.sh` by `spikes/legacy-sabotage/self-test.sh:85-88`; the clean build created all required entries at `spikes/legacy-sabotage/fixtures/build-clean.sh:16-24`. | Adds one legacy file after the dist prerequisite is satisfied; source, tarball and materialized inputs are unchanged. | `legacy_dist_files=1`, other four 0, exit 1. |
| Tarball | `spikes/legacy-sabotage/fixtures/generated-hook.sh:2`, injected only into the already-`npm pack`ed archive by `spikes/legacy-sabotage/self-test.sh:90-97`; pack creation is `spikes/legacy-sabotage/self-test.sh:44-51`. | Replaces one packed artifact with the same archive plus one legacy member; built dist and materialized roots stay clean. | `legacy_tarball_files=1`, other four 0, exit 1. |
| Materialized | `spikes/legacy-sabotage/fixtures/generated-hook.sh:2`, copied only after the materializer created `.codex/hooks.json` (`spikes/legacy-sabotage/fixtures/materialize-clean.sh:4-6`, `spikes/legacy-sabotage/self-test.sh:99-102`). | Adds one executable project copy without touching source, dist or tarball. | `legacy_materialized_files=1`, other four 0, exit 1. |
| Runtime | `spikes/legacy-sabotage/fixtures/runtime-legacy-read.mjs:3` reads the one disposable `session.json` created by `spikes/legacy-sabotage/self-test.sh:104-110`. | Makes one Node read call under `strace`; three kernel `%file` lines match while all static/shipped surfaces remain clean. | `runtime_legacy_reads=3`, other four 0, exit 1. |

The gate assertions and classification are source-backed at
`spikes/legacy-sabotage/gate.sh:17-44,63-174,187-215,260-275`; the self-test verifies the clean PASS and each exact
counter at `spikes/legacy-sabotage/self-test.sh:119-158`. The complete before command is `clean.command`; each
after command is its adjacent `*-fail.command`. Raw stderr contains exactly
`legacy gate: FAIL (all measured legacy counts must be zero)` for every valid counterexample.

Earlier v2-v4 attempts are also retained, not rewritten: v2 records a fixture path-normalization bug, v3 records
missing executable permission, and v4 records a non-minimal tarball mutation that polluted both dist and tarball.
They are environment/harness diagnostics, not contractual fail-first evidence. v5 first proved independent counts;
v6-v8 explored persistent fixtures but were rejected because sabotage must stay below `mktemp -d`; v9 restored the
safety boundary. v10 is the canonical run against the final parameterized self-test.

## HTML paragraphs that need later correction

Do not edit the frozen review HTML in this audit. The executable findings require these targeted updates by their
owners:

- `session-platform-construction-roadmap.html` §2 dependency graph: move importer build/proof before M6 while
  leaving the one-way invocation at M7.
- Same page §4 M6/M7 milestones: M6 may remove normal readers only after the importer is proved; M7 must not be the
  first point at which the legacy codec exists.
- Same page §5 legacy deletion table: split record locks into DB transactions and named external-effect fences;
  narrow observer demolition; add `/tmp` rendezvous, global manifest, dist/tarball and materialized-copy rows.
- Same page §6 attack table: every row currently lacks an exact fixture path, product command and trace selector;
  “observer stopped” also lacks the independent dashboard freshness proof, and “file-access/import graph” names no
  runnable mechanism. Add the L01-L11/R01-R09 scripts and selected `strace -f` contract.
- Same page §8 merge evidence: “static audit zero” does not classify test-only evidence, “file-access trace” does
  not name process ancestry/coverage, and generated/tarball/materialized hook counts are absent. Bind it to the
  five executable counts, per-count prerequisite lines and per-surface traces; source zero alone is inadmissible.
- Same page §9 migration/rollback: state that importer/codecs are built and proven before M6, invoked at M7, and
  deleted only at M8/rollback-window close.
- `session-platform-architecture.html` §9 “application lock files”: replace blanket removal with DB-lock removal
  plus retained named Git/harness/resource fences; likewise narrow filesystem-observer removal to communication
  correctness and retain dashboard DB revision convergence plus Git/project watchers.
- `session-management-refactor.html` §7 mapping: split delivery locks from record/external-effect fences, add the
  two live compatibility paths, and make generated/materialized copies an independent removal surface.
- Same page §8 migration: make the already-correct import-before-YATU order the controlling order for the roadmap
  and state when importer codecs are finally deleted.
- Same page §11 hard rules: extend old-client refusal/package-boundary verification to tarballs, real materialized
  hook traces, and explicit rejection of old env/global-manifest/unstamped-socket aliases.
