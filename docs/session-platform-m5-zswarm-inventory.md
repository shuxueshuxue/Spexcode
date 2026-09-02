# Session platform M5: ZSwarm legacy inventory

Base: `f0694a5a83aad501b169a9d0cc0f71fd6fe7d306`.

External source anchor: `/home/jeffry/zcode`, object `b9b3fa701cad92614285291242930fa59a70cc1f`. The live checkout
was inspected read-only; its current branch is `codex/swarm-worktree-isolation`, so no checkout/branch/worktree
mutation was performed. The fixed source ref is the evidence boundary for z-code claims.

## Result

The fixed z-code adapter consumes the legacy bridge and reaches nine G.1 facilities plus two G.2 package/config
facilities. The row ledger is:

| scope | `CONSUMER` | `NO-CONSUMER` | `NOT-MEASURED` |
|---|---:|---:|---:|
| G.1 L01-L11 | 9 | 2 | 0 |
| G.2 R01-R09 | 2 | 0 | 7 |
| total | **11** | **2** | **7** |

`NO-CONSUMER` means the named ref's adapter has no path to that facility. It does not mean every z-code branch or
release is clean. `NOT-MEASURED` is used where the source snapshot cannot establish the running product's artifact,
process, or installed-copy behavior.

This corrects the earlier M5 draft's “no production importer” claim. “No importer in this repository” remains true; “ZSwarm use is unproven” is false once
the external z-code ref is inspected.

## Fail-first evidence

The first read-only external check was captured before this ledger was written. It is retained byte-for-byte in the
external study archive and indexed by `.spec/spexcode/session-runtime/zswarm-inventory/evidence/README.md`:

```text
sha256  2fb6bf3f76213587ac208d216b546968d8f54817b2494f72fd535eb90ab6899f
lines   763
```

The capture includes the exact commands and selected output for the z-code worktree/ref, package declaration, all
six bridge imports, the z-code spec, and the narrow source search. It is the audit's first observation, not a
generated product trace and not a claim that a live swarm process was running.

## External importer and six-function mapping

The package declaration is z-code `apps/zcode-cli/packages/bootstrap/package.json:23-34`; line 24 pins
`"@spexcode/session-core": "0.6.7"`. The adapter imports all six bridge exports at
`apps/zcode-cli/packages/bootstrap/src/swarm-session-protocol.ts:1-8`.

| bridge function | z-code call site at `b9b3fa701` | legacy effect and path shape at base |
|---|---|---|
| `runtimeSessionChildren` | `apps/zcode-cli/packages/bootstrap/src/swarm-session-protocol.ts:70-84` (`children`) | `runtime-session.ts:382-388` enumerates `listSessionIds()`, reads each `sessions/<id>/session.json`, filters `parent` and `runtime_owner`, and sorts. This is a read of session records, not `cursors.json`. |
| `registerRuntimeSession` | `.../swarm-session-protocol.ts:87-97` (`register`) | `runtime-session.ts:224-247` holds `.session-locks`, validates parent, writes `sessions/<id>/session.json` at `:239`, and for a child writes `sessions/<child>/watchers.json` at `:240-245`. |
| `publishRuntimeSessionState` | `.../swarm-session-protocol.ts:100-110` (`publish`) | `runtime-session.ts:301-374` reads record/watchers, holds `.session-locks` then `.delivery-locks` (`:308-310`), writes lifecycle/runtime fields to `session.json` (`:342-350`), appends status and sent records through `recordStatus`/`appendSent` (`:350`, `:364`), and writes pending debt (`:365`). It clears `snapshotPending` in `watchers.json` (`:369-372`). |
| `readRuntimeSession` | `.../swarm-session-protocol.ts:113-116` (`drain`) and bridge validation at `:114-115` | `runtime-session.ts:377-380` reads `sessions/<id>/session.json`; in notification validation it is also called at `:285`. |
| `runtimeSessionNotification` | `.../swarm-session-protocol.ts:116-129` (`drain` callback) | `runtime-session.ts:280-298` validates message attributes, child record, parent and owner by reading `session.json`; it does not write a file. |
| `drain` | `.../swarm-session-protocol.ts:116-130` (`drain`) | Imported queue drain consumes `sessions/<parent>/pending.json`, checks timeline dispatch receipts, calls ZSwarm's `accept`, settles receipt, and removes the queue head under `.delivery-locks`; queue paths/lock are `delivery-queue.ts:20-30,151-190`, receipt reads/settlement are `:171-181`. |

The bridge's own status/message writers are the legacy timeline functions `session-timeline.ts:118-158`: status and
sent events are in `sessions/<id>/timeline.ndjson` or numbered `sessions/<id>/timeline/*.ndjson` segments. The queue
writer is `delivery-queue.ts:83-92,119-129`, and the two lock families are `.session-locks/<id>.lock`
(`record-lock.ts:5,16-24,53-72`) and `.delivery-locks/<id>.lock` (`delivery-queue.ts:21,29-55`).

The z-code spec at `.spec/zcode/swarm-orchestration/session-protocol/spec.md:20-23` says record, timeline, parent
watch, pending queue, cursor and locks. Code wins over prose: the adapter imports no cursor API, and the six bridge
calls above never call `readCursors`, `followCursor`, or `advanceFollow` (`packages/session-core/src/index.ts:1-24`
shows those as separate exports). Cursor consumption is therefore `NO-CONSUMER` for this fixed adapter; other
branches/releases remain outside the measured scope.

## Store-root resolution

The base code resolves the bridge's store as follows:

1. `packages/spec-core/src/project-store.ts:7-16` uses `SPEXCODE_HOME`, otherwise `$HOME/.spexcode`, then appends
   `projects/<encodeProject(dirname(git-common-dir))>`; `encodeProject` replaces `/` and `.` with `-`.
2. `packages/spec-core/src/layout.ts:237-239` calls `gitCommonDir()` for the current checkout and passes it to
   `projectRuntimeRoot`; `gitCommonDir` invokes `git rev-parse --path-format=absolute --git-common-dir` at
   `layout.ts:169-182`.
3. `packages/spec-core/src/layout.ts:255-258` appends `sessions/<sessionId>/session.json` or the named artifact.

For the inspected `/home/jeffry/zcode` checkout, read-only `git rev-parse` returned
`/home/jeffry/zcode/.git`, so the default disk shape is:

```text
/home/jeffry/.spexcode/projects/-home-jeffry-zcode/
  sessions/<sessionId>/session.json
  sessions/<sessionId>/watchers.json
  sessions/<sessionId>/timeline.ndjson
  sessions/<sessionId>/timeline/<12-digit>.ndjson
  sessions/<sessionId>/pending.json
/home/jeffry/.spexcode/projects/-home-jeffry-zcode/.session-locks/<id>.lock
/home/jeffry/.spexcode/projects/-home-jeffry-zcode/.delivery-locks/<id>.lock
```

When `SPEXCODE_HOME` is set, only the first prefix changes. A linked worktree resolves through its shared Git common
dir; separate `/home/jeffry/zswarm-*` repositories resolve separate encoded project keys. Read-only checks found
those workspaces and their `.git` directories, but no session-shaped files inside them and no current z-code session
records under `/home/jeffry/.spexcode/projects/-home-jeffry-zcode`. That is evidence of current absence on this host,
not evidence that no swarm run ever wrote the store.

## G.1 decisions for ZSwarm

| ID | decision | fixed-ref evidence |
|---|---|---|
| L01 `pending.json` | **CONSUMER** | `swarm-session-protocol.ts:116-130` calls `drain`; queue path/read/write are `delivery-queue.ts:20,58-92,119-129`. |
| L02 timeline | **CONSUMER** | `publish` reaches `recordStatus` and `appendSent` through `runtime-session.ts:350,364`; `drain` reads/settles dispatch receipts through `delivery-queue.ts:171-181`. |
| L03 `cursors.json` | **NO-CONSUMER** | No cursor import/call in the adapter; cursor exports are separate at `session-core/src/index.ts:15`. The z-code prose mentions cursor, but no code path here uses it. |
| L04 parent/watch | **CONSUMER** | Child registration writes `watchers.json` at `runtime-session.ts:240-245`; publication reads and clears it at `:308,369-372`; parent is also stored in `session.json`. |
| L05 `session.json` | **CONSUMER** | Registration writes `:239`; publication reads/writes `:306-349`; read/children/notification read it at `:112-117,285,377-388`. |
| L06 `.delivery-locks` | **CONSUMER** | Publication nests `withDeliveryLocks` at `runtime-session.ts:308-310`; imported `drain` acquires the same family at `delivery-queue.ts:151-158`. |
| L07 `.session-locks` | **CONSUMER** | Registration uses `withSessionRecordLocks` at `runtime-session.ts:227`; publication uses it at `:309`. |
| L08 store observer/poll | **NO-CONSUMER** | The adapter invokes synchronous record/queue operations only (`swarm-session-protocol.ts:68-132`); no store watcher or poll API is imported by this bridge. Other ZSwarm runtime observers are not inferred. |
| L09 mixed `runtime-session.ts` bridge | **CONSUMER** | Package declaration `package.json:24` and all six imports `swarm-session-protocol.ts:1-8`; production wiring constructs the port at `create-app.ts:65,334`. |
| L10 `.revoked-senders` | **CONSUMER** | Imported `drain` checks `senderDeliveryRevoked` before delivery at `delivery-queue.ts:163-167`; the bridge's drain reaches that reader. No ZSwarm writer for revocation was observed. |
| L11 dispatch receipts/settlement | **CONSUMER** | Publication creates receipt-bearing `appendSent` calls at `runtime-session.ts:329-365`; drain validates and settles them at `delivery-queue.ts:171-181`. |

## G.2 decisions for ZSwarm

| ID | decision | fixed-ref evidence boundary |
|---|---|---|
| R01 prompt/launch artifacts | **NOT-MEASURED(real ZSwarm launch artifact state was not run or traced)** | The bridge source does not name these paths; core/bootstrap launch behavior is outside the narrow adapter audit. |
| R02 PID/identity/rendezvous/socket | **NOT-MEASURED(real swarm process/native control state was not observed)** | No live process or socket proof was collected. |
| R03 Codex generation manifest/lock | **NOT-MEASURED(ZSwarm generation reuse was not run)** | No fixed-ref bridge call reaches this facility; absence in this adapter is not a product-wide claim. |
| R04 `SPEXCODE_HOME`/Git/config locator | **CONSUMER** | `runtimeRoot()` uses `SPEXCODE_HOME` and Git common-dir (`layout.ts:237-239`; `project-store.ts:7-16`); every bridge record/queue/lock path calls that root. |
| R05 legacy package root/internal exports | **CONSUMER** | z-code declares and imports the root package (`package.json:24`, `swarm-session-protocol.ts:1-8`); package exports root and `./internal` at `packages/session-core/package.json:9-12`. |
| R06 generated `dist`/packed copies | **NOT-MEASURED(installed tarball and clean dist were not built or traced)** | Source import proves dependency, not the installed-copy deletion surface. |
| R07 materialized harness config/plugins/manifests | **NOT-MEASURED(ZSwarm materialization path was not exercised)** | No bridge call names materialize or hook manifests; no clean adopter rematerialization proof was run. |
| R08 `files.json`/`web.json` manifests | **NOT-MEASURED(ZSwarm resource surfaces were not exercised)** | The bridge does not import those modules; other runtime use is outside this ref-scoped audit. |
| R09 close ledger/quarantine/create candidates | **NOT-MEASURED(lifecycle repair and concurrent create were not exercised)** | No live close/recovery/create run was available to measure. |

## Deletion targets

### z-code-owned target list

The mechanically actionable z-code target is the bridge integration and its legacy package dependency:

1. Replace the import and adapter implementation at `apps/zcode-cli/packages/bootstrap/src/swarm-session-protocol.ts:1-132`
   with the split protocol/topology/runtime composition, preserving the public `SwarmSessionProtocolPort` behavior.
2. Remove `@spexcode/session-core` from `apps/zcode-cli/packages/bootstrap/package.json:24` after the replacement is
   installed and its clean consumer proof passes.
3. Remove any z-code compatibility adapter/spec references only after the new proof covers registration, parent edge,
   lifecycle projection, pending delivery, crash recovery and resumed worker identity. This lane does not edit z-code.

The old facilities that the replacement must make deletable are exactly L01, L02's bridge-owned status/message
publication and receipts, L04 parent watch projection, L05 bridge-owned runtime fields/records, L06, L07's bridge
locks, L09 and L11. L03, L08, and L10's writer are not claimed as z-code deletion targets from this ref alone. R01-R03,
R06-R09 remain `NOT-MEASURED` and cannot be put on a mechanical kill list.

### This repository's target list

**Proven empty.** The criterion is “consumed by ZSwarm and already replaced with equal behavior by M5 in this
repository.” ZSwarm consumes `packages/session-core/src/runtime-session.ts` (L09), but M5 has not replaced or removed
that bridge in this repository; the replacement lives in z-code. Therefore no product file, export, lock, timeline,
queue codec, or generated copy in this repository is an M5 deletion target. M6/M8 own the bridge removal after the
external adopter cutover.

The emptiness is falsifiable: install the replacement in z-code, run its public workflow with the old package/bridge
absent, then re-run the repository deletion gate's static, dist/tarball, materialized-copy, and runtime-access counts.
Any remaining ZSwarm call or legacy access reopens this set; until those measurements pass, deleting
`runtime-session.ts` is blocked.

## Evidence limits and correction record

Not measured: the authoritative macOS checkout `~/Codebase/temp/z-code`; any z-code branch/release other than
`b9b3fa701`; a live ZSwarm process and its actual `SPEXCODE_HOME`; installed packed copies/dist; and ZSwarm's native
launch, process, resource, close, quarantine, or create surfaces. The local `/home/jeffry/zswarm-*` directories are
real read-only Git workspaces, but no session-shaped artifacts were found in them, so they cannot close those gaps.

Corrected from the inherited record: “no production importer” is true only inside this repository; the external
importer is real, wired in `create-app.ts`, and imports all six bridge exports. The z-code spec's cursor sentence is
also corrected by code: cursor is not consumed by this fixed bridge adapter. No other inherited claim is upgraded
from documentation alone.
