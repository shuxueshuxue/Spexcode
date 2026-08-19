# Session communication architecture concept map

Status: review worksheet for the SQLite-backed target. This document records usefulness proofs and subtraction
decisions; it does not silently change a current implementation. A decision becomes an implementation contract only
when its owning spec is updated and the corresponding cutover proof lands.

## Review method

- **KEEP** means the element has an independent invariant and remains after cutover.
- **MOVE** means the invariant is real but belongs to another owner.
- **REMOVE** means the new retained mechanism makes the element redundant.
- **OPEN** means evidence is still missing; it cannot be treated as an implementation requirement.

The key review question is adversarial: can the adopter still work when the candidate legacy facility is absent,
corrupt, read-only, or stopped? If yes, the legacy facility has no runtime usefulness and must be deleted in the same
cutover. A compatibility layer is not a neutral resting place; it is a second source of truth.

## Concept map

```text
Adopter config resolver
  +-- explicit databasePath (absolute)
  +-- application namespace / project namespace
  |
  +-- openSessionDatabase(databasePath)
          |
          +-- session-communication-protocol
          |     +-- initialize
          |     +-- enqueue
          |     +-- dequeue
          |     +-- listPending / readMessages
          |     +-- retire
          |     +-- migrations + transaction errors
          |
          +-- adopter-owned topology tables
          |     +-- attach / detach / reparent / relation queries
          |     +-- optional same-transaction enqueue
          |
          +-- adopter runtime
          |     +-- dequeue loop / reconciliation / wake hint
          |     +-- handler journal only when downstream retry is required
          |     +-- HarnessRuntimeAdapter
          |
          +-- HarnessMaterializeAdapter
                +-- hooks / contracts / skills / commands / trust

ZSwarm          -> protocol + ZSwarm topology/runtime/config
self-launch     -> protocol + explicit listener + harness adapters
Spex governed   -> protocol + Spex topology/lifecycle + harness adapters
```

The protocol language never names an adopter, product, parent, lifecycle, harness, worktree, or native identity.
There is one database per adopter-owned application state instance. The database file name is adopter policy; the
protocol receives only an absolute path. A file observer may reduce latency, but database queries and startup
reconciliation own correctness.

## A. Durable storage elements

| ID | Element | Decision | Usefulness proof / deletion proof |
|---|---|---|---|
| F01 | Explicit absolute `databasePath` | **KEEP** | Every process needs one deterministic namespace; explicit injection prevents cwd and vendor-root coupling. |
| F02 | Adopter-owned SQLite database | **KEEP** | WAL and short transactions provide one cross-process authority without a central daemon. |
| F03 | `schema_migrations` registry | **KEEP** | Component-owned, checksummed migrations prevent packages from competing over one global version integer. |
| F04 | `protocol_sessions` table | **KEEP** | It establishes exact protocol addresses without governed records or filesystem directory inference. |
| F05 | `protocol_messages` table | **KEEP** | Immutable messages, FIFO order, idempotency and dequeue state are one durable language. |
| F06 | Partial pending index | **KEEP** | Current work-list queries stay proportional to pending rows rather than full history. |
| F07 | SQLite WAL/SHM files | **KEEP** | They are SQLite's storage mechanism, not application-level files to interpret or clean manually. |
| F08 | Protocol `session.json` identity file | **REMOVE from target** | The database address row supplies identity; keeping a second universal identity file creates another authority. |
| F09 | `pending.json` / delivery queue files | **REMOVE** | The partial pending index provides the same query; sabotage must leave enqueue/dequeue correct. |
| F10 | `timeline.ndjson` protocol history | **REMOVE** | Message history is queried from the database; lifecycle/event history may remain in its owning adopter. |
| F11 | Protocol `cursors.json` | **REMOVE** | Cursor state is a consumer read model, not delivery truth; readers keep their own cursor if needed. |
| F12 | Journal / WAL written by application code | **REMOVE** | SQLite already supplies transaction recovery; a second journal recreates the failure modes being removed. |
| F13 | Application lock files | **REMOVE** | SQLite transaction locking replaces protocol locks; native process ownership locks stay in harness adapters. |
| F14 | Filesystem observer as correctness source | **REMOVE** | `fs.watch` can coalesce, duplicate, delay, or lose events; it can only be a wake hint. |
| F15 | Adopter topology tables | **MOVE / KEEP** | Relations are real, but topology owns them. Same-database topology mutation plus enqueue can be one short transaction. |
| F16 | Transactional protocol outbox | **REMOVE** | No second queue is needed when relation mutation and protocol enqueue share one adopter database transaction. |
| F17 | Artifacts and materialized harness files | **KEEP outside DB** | Large evidence and harness-discovered files are not relational protocol state. |
| F18 | Launch proof, PID, socket, endpoint | **MOVE** | Native runtime identity and liveness belong to `HarnessRuntimeAdapter`, never to protocol tables. |
| F19 | Spex lifecycle/worktree/branch/proposal facts | **MOVE** | They remain durable adopter state, not protocol vocabulary. |
| F20 | Config file and configurable config locator | **KEEP, adopter-owned** | A machine-level bootstrap is needed before a project/session exists; its location must be relocatable. |

## B. Packages and modules

| ID | Element | Decision | Usefulness proof / deletion proof |
|---|---|---|---|
| P01 | `session-communication-protocol` published package | **KEEP** | ZSwarm, self-launch and Spex need one codec, schema and transaction contract. |
| P02 | `@spexcode/spec-core` dependency inside protocol | **REMOVE** | Storage placement is adopter configuration, not protocol semantics. |
| P03 | `@spexcode/session-core` package/re-export | **REMOVE after cutover** | It has no independent responsibility once callers use the full protocol package; no permanent compatibility alias. |
| P04 | `session-topology` module | **KEEP internal first** | Relation invariants need a neutral owner without forcing them into queue or harness code. |
| P05 | Published topology package | **OPEN** | Publish only after two non-identical adopters prove the same relation semantics. |
| P06 | Shared runtime class/daemon | **REMOVE** | Adopters have different wake, liveness and native-input policy; a shared class becomes policy switches. |
| P07 | Spex governed runtime | **KEEP adopter-owned** | It owns lifecycle, governance, reconciliation and managed resources. |
| P08 | ZSwarm runtime | **KEEP adopter-owned** | It owns worker loops, steering, workspaces and task state. |
| P09 | Self-launch listener | **KEEP adopter-owned surface** | It is the explicit consumer when no resident backend exists. |
| P10 | `runtime-session.ts` mixed bridge | **REMOVE** | Its record, topology, projection and message responsibilities have separate owners. |
| P11 | Shared filesystem observer service | **REMOVE** | No adopter may depend on it for correctness; a local wake hint is adopter policy. |
| P12 | Generic configuration package in protocol | **REMOVE** | Adopters need different config sources; protocol accepts a path, not a config framework. |

## C. Public types and operations

| ID | Element | Decision | Usefulness proof / deletion proof |
|---|---|---|---|
| T01 | `SessionProtocol` interface | **KEEP** | One coherent operation set prevents callers from reconstructing half-transactions. |
| T02 | `openSessionDatabase({ databasePath })` | **KEEP** | It validates one fixed storage instance without global cwd/environment mutation. |
| T03 | `SessionId` validated string | **KEEP** | It is the address key; validation prevents traversal without product-specific prefixes. |
| T04 | `Message` immutable envelope | **KEEP** | It is the fixed cross-adopter language; product facts remain opaque kind/headers. |
| T05 | `idempotencyKey` | **KEEP** | Producer uncertainty can be replayed without duplicate messages or changed payload reuse. |
| T06 | `SessionProtocolError` stable code union | **KEEP** | Consumers need machine-readable recovery without parsing prose or maintaining subclasses. |
| T07 | `enqueue` | **KEEP** | It commits a pending message; it does not initialize unknown targets or call an adapter. |
| T08 | `dequeue` | **KEEP** | Its transaction commit is the protocol delivery boundary; downstream native effects are consumer policy. |
| T09 | `listPending` / `readMessages` | **KEEP** | They separate work-list inspection from immutable history reads. |
| T10 | Public lock/journal/queue replacement helpers | **REMOVE** | Raw half-transactions permit callers to bypass invariants and recreate legacy coordination. |
| T11 | Adapter callback held under protocol lock | **REMOVE** | It makes transaction latency and deadlock behavior depend on external processes. |
| T12 | Handler journal | **MOVE / KEEP only in consumer** | A consumer that needs post-dequeue retry may own one; it never extends protocol state. |
| T13 | `HarnessRuntimeAdapter` | **KEEP outside protocol** | Native launch/input/stop/liveness is a real responsibility with platform-specific proof. |
| T14 | `HarnessMaterializeAdapter` | **KEEP outside protocol** | Setup artifacts must be placed where a harness discovers them. |
| T15 | Product operations such as `publishWorking`, `notifyParent`, `recordStatus` | **REMOVE from protocol** | They combine product state, relation policy, wording and enqueue; adopter runtime composes them. |

## D. Transaction rules

| ID | Rule | Decision | Usefulness proof / deletion proof |
|---|---|---|---|
| X01 | Short synchronous SQLite transaction | **KEEP** | A write lock contains only SQL; no network, filesystem walk, harness call or user callback. |
| X02 | `dequeue` at-most-once ownership transfer | **KEEP** | It makes the protocol closed and prevents downstream adapter behavior from changing queue truth. |
| X03 | Idempotent enqueue | **KEEP** | Retries after uncertain completion are safe and changed-key reuse fails loudly. |
| X04 | Strict corruption errors | **KEEP** | Corrupt-as-empty is silent message loss; malformed state must fail loud. |
| X05 | Startup and bounded reconciliation | **KEEP in long-lived adopters** | Lost wake hints cannot hide pending rows; correctness comes from querying durable state. |
| X06 | Cross-component same-DB transaction | **KEEP where needed** | Topology mutation and its notification can commit atomically without an outbox. |
| X07 | Multi-address public transaction/lock API | **REMOVE** | No shared operation needs it; individual idempotent enqueue avoids deadlock and policy leakage. |
| X08 | Automatic journal compaction | **OPEN** | Add only after measured recovery cost justifies a new mechanism. |
| X09 | One-way offline migration | **KEEP as tooling only** | User data may need conversion, but normal runtime must never recognize the legacy format. |

## E. Adopter cutover proof

| Adopter | Positive proof | Legacy sabotage | Physical deletion |
|---|---|---|---|
| ZSwarm | External clean consumer initializes, enqueues, dequeues and routes topology using its own DB/config. | No Spex backend, hooks, `.spexcode`, governed records or Spex package available. | Remove ZSwarm's old mailbox/projection and compatibility imports in the same milestone. |
| self-launch | Backend absent; producer enqueues; explicit listener later dequeues through harness input. | Old pending files missing/read-only and observer stopped. | Remove file queue, fixed-root lookup and observer correctness path. |
| Spex governed | CLI/hook/dashboard/backend share protocol; restart/lost wake still recovers pending. | Old JSON queue/timeline/cursors/locks poisoned or absent; observer disabled. | Remove old readers/writers, bridge, locks and duplicate relation authority. |

## F. Final subtraction test

The refactor is complete only when all of the following are true:

1. Each adopter passes through its real public surface.
2. Its legacy sabotage run passes without the legacy facility.
3. Static imports, generated files and runtime file-access traces for deleted facilities are zero.
4. There is one protocol database authority and no protocol compatibility branch.
5. A required data upgrade is a bounded one-way migration, not a normal runtime fallback.
6. The net count of authorities, locks, observers, processes and configuration aliases decreases.

The construction roadmap is the control view for assigning writers, adversaries, evaluators and integrators against
these decisions. The two linked HTML review views explain the target architecture and SQLite refactor details; none
of the three documents authorizes production migration before the owning specs and cutover gates are accepted.

## G. M0 legacy inventory at `2572f66c26fc612f93dc36bc586be5b05cc2933e`

This is the source-backed deletion ledger for M0. It records production readers and writers in this repository;
test-only imports are evidence, not consumers. The sibling `distill-51f5` worktree is at the same base and contains no
tracked protocol implementation to inherit. A public export without a repository caller is therefore recorded as an
unproven external compatibility surface, not as a fictional ZSwarm consumer.

Milestones below use the construction-roadmap numbering: M1 contract, M2 SQLite, M3 topology, M4 self-launch, M5
ZSwarm, M6 Spex cutover, M7 one-way migration and M8 demolition. `M6/M8` means stop normal use and remove the active
path at M6, then remove its last migration, packaging or generated residue at M8.

### G.1 Communication and state authorities

| ID | Current facility | Real readers and last product consumer | Writers and shared-writer answer | Replacement authority and deletion milestone | Minimum sabotage proof |
|---|---|---|---|---|---|
| L01 | Per-session `pending.json` | `delivery-queue.ts` reads debt for `drain`, `owesDelivery` and stranded-close reporting. `sendText` drains immediately; backend `superviseDelivery` polls every two seconds. Last product surfaces are `spex session send`, `POST /api/sessions/:id/input`, dashboard compose and backend restart recovery (`packages/session-core/src/delivery-queue.ts:20`, `spec-cli/src/sessions.ts:1779`, `spec-cli/src/sessions.ts:4239`). | `enqueue`/`drain`; `acceptMessage`; runtime-session notification; reparent revoke/restore. **Shared writer: yes** -- message acceptance also writes timeline, runtime-session also writes session/watch state, and reparent also writes watcher/session state. | Protocol message rows plus a pending index; runtime-owned dequeue/reconciliation. Stop normal reads/writes and remove queue codec at **M6**; remove migration residue at **M8**. | Make every old `pending.json` and `.delivery-locks` path absent or read-only. Send through CLI/API, kill or delay the wake, restart the backend, and observe one adapter receipt in FIFO order with zero old-path accesses. |
| L02 | `timeline.ndjson` plus immutable `timeline/*.ndjson` segments | `timelineTail` feeds dashboard/API history; `timelineStamp`/`timelineEvents` feed `session wait` and `watch stream`; `lastHumanSendVia` changes prompt composition; `currentHumanTurn` binds execution; dispatch receipt readers recover keyed sends (`packages/session-core/src/session-timeline.ts:33`, `spec-cli/src/session-follow.ts:124`, `spec-cli/src/session-execution.ts:23`). There is no single last consumer: public history, follow/wait, execution and dispatch recovery are all live. | `recordStatus` after `session.json` mutation; `appendSent` during acceptance; `settleSentDispatch` during drain; runtime-session state/notification. **Shared writer: yes** with session, pending and runtime bridge writes. Status append is currently best-effort while send append is correctness-critical. | Split authority: immutable protocol messages for sends; adopter lifecycle history for status; explicit consumer handler/idempotency state for dispatch settlement. Cut normal readers/writers at **M6**. The isolated importer must exist before that cut and is removed at **M8** after M7 migration. | Poison the legacy log while new DB state remains valid. Prove dashboard history, CLI follow/wait, prompt transition, execution binding and keyed replay through their public surfaces; trace zero normal-runtime reads of either legacy log form. |
| L03 | Per-reader `cursors.json` | `followCursor`, `followedSessions` and `unreadSince` are used by `spec-cli/src/session-follow.ts`; `advanceFollow` is the only production writer. Last consumers are `spex session wait` and `spex session watch stream`, including a session following its own inbox (`packages/session-core/src/session-cursors.ts:15`, `spec-cli/src/session-follow.ts:108`). | `advanceFollow` atomically rewrites the file. **Shared writer: no**; it reads the shared timeline but does not participate in another file transaction. | **Unresolved M1 decision:** either adopter-owned durable cursor rows, or an explicit at-least-once ephemeral CLI cursor contract. A vague "consumer-owned cursor" is not a replacement because this file is already consumer-owned and durable. Delete at **M6** only after that choice and cutover proof. | Delete/corrupt the file, restart the wait/watch consumer, and prove the accepted resume contract: no missed relevant event for durable cursors, or bounded replay without loss for at-least-once cursors. |
| L04 | `watchers.json` plus `session.json.parent` fallback | Watch list/cancel, parent auto-subscribe, reparent and status notification read target-owned watcher rows; rows lacking a source infer it from `session.json.parent`. Last product surfaces are `spex session watch/list/cancel`, `session new --parent`, reparent and parent notification (`spec-cli/src/sessions.ts:475`, `spec-cli/src/sessions.ts:477`, `packages/session-core/src/runtime-session.ts:86`). | Subscribe/cancel/settle, session creation and reparent; runtime-session maintains a second implementation. `scheduleWatchNotifications` queues fire-and-forget sends after a record write. **Shared writer: yes** with session, pending and runtime bridge state. | Adopter topology edge rows; relation mutation and keyed protocol enqueue in one same-DB transaction. Build in M3, cut Spex readers/writers at **M6**, remove fallback/import residue at **M8**. | Put contradictory parent/watch files beside authoritative topology rows. Watch, reparent and lifecycle notification must follow only DB edges, survive dropped wake/restart, and produce zero old watcher/parent reads. |
| L05 | Monolithic per-session `session.json` | `spec-core` layout/list/alias readers; session lifecycle/list/liveness/launch; graph projection and dashboard; timeline/execution guards; files/web guards; host resources and eval inference; shell hooks; Codex generation bootstrap; machine-peer remote state. These are all live last consumers, not one replaceable reader (`packages/spec-core/src/layout.ts:135`, `spec-cli/src/sessions.ts:431`, `spec-cli/hooks/harness.sh:126`). | `spec-cli/src/sessions.ts` owns governed record replacement and then status/watch side effects; `runtime-session.ts` independently writes external records. Shell hooks call CLI internal mutations rather than writing JSON directly. **Shared writer: yes** with timeline/watchers, and the bridge additionally writes pending. | Intended split is protocol identity, Spex lifecycle/worktree/governance, topology edges and adapter runtime facts, but the identity authority is blocked by the spec conflict in G.5. Cut normal governed use at **M6**, run isolated M7 import, delete path codecs/shell mirrors at **M8**. | Rename or deny the old sessions root after loading an explicit DB path. Prove CLI list/send/lifecycle, dashboard/graph, hooks, eval/resource lookup and restart. Compare migration output before removal and trace zero normal-runtime `session.json` reads. |
| L06 | `.delivery-locks/<session>.lock` PID directories | `acceptMessage` keyed acceptance, queue `drain`, runtime bridge and reparent use it around adapter delivery and queue mutation (`packages/session-core/src/delivery-queue.ts:29`, `packages/session-core/src/delivery-queue.ts:139`). The last consumer is the same immediate/retry delivery loop as L01. | Created/reclaimed by `delivery-queue.ts`; held across pending/timeline work and, during drain, external adapter insertion. **Shared writer: yes** with L01/L02/L04/L09. | SQLite transaction locking for protocol rows; any post-dequeue adapter journal is consumer-owned and cannot be protected by a protocol lock. Delete at **M6**, residue at **M8**. | Run concurrent producers and consumers with the lock root unavailable. Replays stay idempotent, FIFO debt is not duplicated, and a killed consumer is recovered by adopter reconciliation. |
| L07 | `.session-locks/<resource>.lock` PID directories | Nearly every session lifecycle mutation, file/web registration, reparent, launch/proof/PID work and synthetic session-create candidate transaction uses `withRecordLock` (`packages/session-core/src/record-lock.ts:5`, `spec-cli/src/sessions.ts:2293`). The last consumers include Git/worktree and harness side effects, not only JSON records. | `record-lock.ts` is the common writer. **Shared writer: yes**, but across unlike resources: session JSON, watcher state, files/web manifests, launch artifacts and candidate reservations. | Split before deletion. SQLite transactions replace only DB-state locking. Adapter/process locks remain adapter-owned; Git/worktree candidate fencing needs its own explicit transaction authority. Remove file-state lock callers at **M6**; delete only the now-unused legacy lock root at **M8**. | Make `.session-locks` unavailable while concurrently exercising DB-only message/topology operations; they must pass. Separately run concurrent create/launch/files operations under their named replacement fences. A queue-only proof is insufficient. |
| L08 | Store filesystem observer and polling correctness paths | `TreeWatcherRegistry` watches the session store for graph-cache invalidation/SSE and pairs it with a 15-second cold patrol; delivery correctness is instead immediate drain plus the two-second `superviseDelivery` poll (`spec-cli/src/graphStream.ts:465`, `spec-cli/src/graphStream.ts:1013`, `spec-cli/src/sessions.ts:1779`). Last consumers are dashboard `/api/graph/stream`, eval freshness and delivery recovery. | No durable writer. **Shared writer: no**, but it observes mutations from every store writer. | DB commit/change signal plus bounded adopter reconciliation for communication; retain/re-scope Git/project filesystem watching for non-DB graph facts. Remove session-store watcher correctness at **M6**, not the entire graph watcher. | Disable the session-store observer and drop a wake: delivery recovers from DB. Independently mutate session DB state and prove dashboard graph refresh through the replacement signal/patrol; disabling delivery alone does not prove the UI. |
| L09 | `packages/session-core/src/runtime-session.ts` mixed bridge | This repository has **no production importer** of its public functions. Only session-core protocol tests and public-boundary tests consume them; the sibling parent worktree adds no implementation. The package root nevertheless publishes `registerRuntimeSession`, `publishRuntimeSessionState`, reads, children and notification (`packages/session-core/src/index.ts:4`). External ZSwarm use is unproven. | One module writes session JSON, parent/watchers, status timeline and pending delivery under both lock families. **Shared writer: yes**, deliberately spanning L01/L02/L04/L05/L06/L07. | Protocol package plus adopter topology/runtime composition. Freeze/remove the mixed root contract once the M5 installed-adopter proof uses split APIs; remove source and Spex calls at **M6**, package residue at **M8**. | Install a clean packed external consumer. The old bridge export must be absent while registration, lifecycle projection, topology notification and dequeue work through their new owners; static imports of `runtime-session` are zero. |
| L10 | Sender revocation `.revoked-senders/<id>` | `revokeSenderDelivery` marks close; `drain` checks it to discard queued debt from a closed sender (`packages/session-core/src/delivery-queue.ts:21`, `spec-cli/src/sessions.ts:3726`). Last consumer is close followed by recipient delivery sweep. | Close writes the marker; queue drain consumes it. **Shared writer: yes** with lifecycle close and pending mutation. | Explicit adopter lifecycle/topology state consulted in the same DB transaction as queue ownership, or a protocol-defined immutable sender tombstone if truly cross-adopter. Decide in M1/M3; cut at **M6**, migrate/delete at **M7/M8**. | Close a sender while stale debt and a racing send exist, with the marker path absent. The recipient never receives revoked debt and no valid later sender is suppressed. |
| L11 | Private dispatch receipts and `dispatch-settled` records embedded in timeline | `sentDispatchReceipt` is read by accept replay, queue drain and runtime bridge; settlement is appended after successful adapter handoff (`packages/session-core/src/session-timeline.ts:140`, `packages/session-core/src/delivery-queue.ts:173`). Last consumer is keyed product operation recovery. | Message acceptance writes receipt metadata; drain writes settlement. **Shared writer: yes** with L01/L02/L09. | Consumer-owned handler/idempotency journal, because protocol dequeue ends protocol ownership. Define its schema and transaction boundary by M2; cut at **M6**, import required unresolved operations in **M7**, delete legacy encoding in **M8**. | Crash after dequeue and around adapter success, then replay the same operation. The product operation occurs according to its stated ownership contract without timeline access or silent duplicate effects. |

### G.2 Runtime, configuration, packages and generated surfaces

| ID | Current facility | Real readers and last product consumer | Writers and shared-writer answer | Replacement authority and deletion milestone | Minimum sabotage proof |
|---|---|---|---|---|---|
| R01 | `prompt`, `launch`, generated `launch.sh`, `launch.proof` | Session create writes prompt/launch; board/detail read prompt; launch/resume reads the first-turn payload; staged proof binds harness/native id/hash/generation before ready (`spec-cli/src/sessions.ts:160`, `spec-cli/src/sessions.ts:173`, `spec-cli/src/sessions.ts:2854`). Last consumer is harness launch and proof consumption. | Session create and harness-specific proof staging. **Shared writer: yes** with lifecycle record creation, but not with protocol queue files. | Keep artifacts outside protocol; move ownership to `HarnessRuntimeAdapter`/Spex lifecycle. Ownership cut at **M6**; **no blanket deletion milestone**. Delete only obsolete formats after adapter migration in M8. | Poison all legacy communication files and launch/stop through the real harness. Conversely install the protocol package in a clean consumer with no launch artifacts present. Both halves must work. |
| R02 | `agent.pid`, `agent.identity.json`, `rv.path`, rendezvous Unix socket, tmux server socket | Hot/warm liveness, host-resource reporting, stop/close identity and Claude delivery read PID/identity/socket stamps. `rvSock` still falls back to `/tmp/spexcode-rv-<id>.sock` when `rv.path` is absent (`spec-cli/src/harness.ts:417`, `spec-cli/src/harness.ts:436`, `spec-cli/src/host-resources.ts:325`). Last consumers are real harness delivery, liveness and exact-process stop. | Launch shell writes PID; lifecycle inspection writes identity; launcher stamps rendezvous path; harness/runtime creates sockets. **Shared writer: no** with communication authority, though lifecycle coordinates them. | Keep adapter-owned runtime identity. Move ownership at **M6**. Remove only the unstamped `/tmp` compatibility lookup at **M8** after old live sessions are drained/migrated. | Remove or conflict the legacy `/tmp` socket and prove stamped delivery/liveness/stop. Then make protocol storage unavailable and prove native runtime control still works. |
| R03 | Codex app-server generation manifest/lock and per-generation PID/receipt/log/socket | Codex harness launch and reuse read `codex-app-server-generations.json`; bootstrap currently reads session JSON to reconstruct assignments. Last consumer is project-scoped Codex runtime reuse (`spec-cli/src/codex-runtime-generations.ts:30`, `spec-cli/src/codex-runtime-generations.ts:307`). | Codex runtime manager writes generation state and its own lock. **Shared writer: no** with protocol; this is a distinct process-resource lock. | Keep in Codex adapter/runtime. Remove only its `session.json` bootstrap dependency at **M6**; retain generation state/lock unless a separate runtime design replaces it. | Deny legacy session records while starting/reusing/stopping multiple Codex generations. Correct generation attachment and cleanup must still pass through the harness surface. |
| R04 | Config/bootstrap: `SPEXCODE_HOME`, git-common-dir-derived project root, `spexcode.json`, `spexcode.local.json`, launcher/tmux/API/Codex env; timeline segment env | `spec-core` derives `<home>/projects/<encoded common-dir>`; `layout.ts` merges the two config files; shell `harness.sh` duplicates root derivation (`packages/spec-core/src/project-store.ts:14`, `packages/spec-core/src/layout.ts:54`, `spec-cli/hooks/harness.sh:119`). Every current store reader is a last consumer. | User/machine configuration and project init/materialize write these inputs. **Shared writer: no**, but all legacy state locators depend on them. | Keep adopter config and relocatable `SPEXCODE_HOME`; pass one resolved absolute `databasePath` into protocol. Delete protocol's git/cwd/global-env placement assumptions and `SPEXCODE_TIMELINE_SEGMENT_BYTES` at **M6/M8**. No current `databasePath` or storage-generation switch exists to reuse. | From an unrelated cwd and custom home, open two explicit DB paths in one process. Protocol operations cannot consult git, Spex config or timeline env; Spex CLI still resolves its adopter config normally. |
| R05 | `@spexcode/session-core` root and `./internal` exports; `spec-cli/src/session-timeline.ts` wildcard re-export | Root exposes accept/drain, cursors, timeline and runtime bridge; `./internal` exposes half-transaction queue/lock/timeline helpers. `spec-cli` is the only production package dependency in this repository and also wildcard-re-exports the root (`packages/session-core/package.json:9`, `spec-cli/src/session-timeline.ts:4`). | Package manifest/index/internal and build output. **Shared writer: yes** at the API surface: it publishes all L01-L11 mechanisms together. | New storage-neutral session protocol package with only coherent operations. Freeze the new contract and remove internal helpers in **M1**; cut Spex imports in **M6**; delete old package, wildcard re-export, workspace/release/lockfile rows in **M8**. | `npm pack` and install into a clean temporary consumer. New exports resolve; old package, bridge and internal subpath do not. Packed dependency graph has no `spec-core` dependency inside protocol. |
| R06 | Generated `dist` outputs | `scripts/build-dist.mjs` atomically replaces ignored `dist`; package tests/packing consume it. Last consumer is the installed CLI/package, not the TypeScript source tree (`scripts/build-dist.mjs:25`). | Root/workspace build scripts. **Shared writer: yes** across source export changes and copied package assets. | Regenerate from the cut source tree. Delete old compiled modules/export maps in the same **M8** demolition commit; never count an unbuilt source-only deletion as proof. | Clean build, pack and install. Search and runtime trace the tarballs for deleted paths/symbols; invoke the installed public APIs rather than workspace sources. |
| R07 | Materialized harness config/plugins and per-tree `hooks-manifest`; legacy global manifest fallback | `materialize` writes harness-discovered settings/plugins/managed blocks plus slot manifest/hash. `dispatch.sh` and doctor prefer the tree slot but fall back to `<runtimeRoot>/hooks-manifest` (`spec-cli/hooks/dispatch.sh:66`, `spec-cli/src/doctor.ts:417`). Last consumer of the global fallback is a pre-slot materialized checkout. Materialized `harness.sh` copies also resolve `session.json`. | Project init/materialize and package hook asset copies. **Shared writer: yes** across source hook assets and every installed project copy, but not one runtime transaction. | Keep materialization as `HarnessMaterializeAdapter`; regenerate its session lookup against adopter APIs. One-way re-materialize before **M6** cutover; delete global-manifest fallback and stale packaged/generated copies at **M8**. | Remove the global manifest, poison old session paths, then run installed init/materialize and a real hook event for each harness. Trace only the per-tree slot and new session authority. |
| R08 | `files.json` and `web.json` session resource manifests | CLI/API/dashboard add/list/retract resources; web proxy consumes web rows. Session existence guards and `withRecordLock` couple them to legacy session state (`spec-cli/src/session-files.ts:31`, `spec-cli/src/session-web.ts:45`). These public surfaces are the last consumers. | Files/web modules rewrite their own manifests. **Shared writer: no** with protocol files, but they share L07 record locks and L05 existence checks. | Keep as adopter-owned artifact metadata unless Spex independently chooses tables. Decouple protocol/session-file guards and lock scope at **M6**; **no protocol deletion milestone**. | Migrate communication to DB while leaving resource manifests in place. Add/list/proxy/retract still work; a clean protocol consumer never reads either manifest. |
| R09 | Close ledger, quarantine bundles and `.session-create-candidates` | Close lookup reads `session-close-ledger.ndjson`; integrity recovery reads/writes quarantine; create reserves candidate state around Git/worktree effects (`spec-cli/src/sessions.ts:108`, `spec-cli/src/sessions.ts:2293`, `spec-cli/src/sessions.ts:3799`). Last consumers are close discovery, repair and concurrent create. | Lifecycle close, integrity tools and session-create transaction. **Shared writer: no** with protocol, but candidate reservations share L07 locks and graph observation. | Keep/move as Spex lifecycle/audit/recovery state. Map any session tombstone needed by protocol explicitly in M1/M3; do not delete these under the queue migration. M7 migrates lifecycle data if chosen; M8 deletes only superseded formats. | With protocol legacy paths absent, close lookup, corrupt-record recovery and concurrent same-branch create still pass through CLI YATU. |

### G.3 Executable kill list

The following is the minimum ordered demolition plan. A later item may not claim closure from static search alone.

1. **M1 -- resolve contracts before implementation.** Choose one session identity authority; decide durable versus
   ephemeral cursor semantics; specify sender revocation/tombstones and post-dequeue handler ownership. Publish a
   protocol surface that contains no raw locks, journals, bridge operations, Git/cwd locator or `spec-core` dependency.
2. **M2 -- build the replacement authorities.** Implement protocol messages/idempotency/pending index and strict
   corruption errors at an explicit absolute DB path. Implement the consumer handler journal required by L11; do not
   hold a SQL transaction across harness callbacks.
3. **M3 -- move relations.** Implement topology edges and same-DB relation+enqueue operations. Remove parent inference
   from watcher rows in the new path and define how closed-sender state participates in that transaction.
4. **M4/M5 -- prove non-Spex adopters.** Backend-absent self-launch and an installed clean ZSwarm consumer must pass
   with Spex packages/config/store unavailable. This is the gate for removing the unproven runtime bridge contract.
5. **Before M6 -- build and prove the M7 importer.** Snapshot/import session identity, pending messages, immutable user
   history, cursor state if retained, topology, unresolved dispatch operations and required tombstones. Compare counts,
   ids, ordering and payload hashes. The importer may read legacy codecs; normal runtime may not.
6. **M6 -- cut Spex in one authority switch.** Replace L01-L11 normal readers/writers, store-observer correctness and
   session-record bootstrap consumers. Regenerate materialized hooks. Split L07 so DB work uses SQLite while
   adapter/Git/resource effects retain named fences. Run CLI, API, dashboard, hook, restart/lost-wake and real-harness
   proofs with old paths missing/read-only/poisoned, then trace zero normal-runtime access.
7. **M7 -- run the one-way data migration.** Stop old writers, import once, archive the immutable source and start only
   the new runtime. Re-running either fails clearly or proves idempotent equality; there is no normal fallback reader.
8. **M8 -- subtract.** Delete legacy codecs, roots, lock implementations that have no retained callers, runtime bridge,
   old package and internal export, wildcard re-export, `/tmp` rendezvous fallback, global hook-manifest fallback,
   stale compat hook copies and generated `dist`. Clean-build, pack/install, rematerialize and verify static imports,
   tarball contents and runtime file-access traces are all zero.

### G.4 Shared-writer collision groups

These groups determine cutover atomicity; deleting one row in isolation would leave a live writer recreating it.

- **Message acceptance:** timeline + pending + delivery lock (`acceptMessage`).
- **Delivery settlement:** pending + private timeline settlement + delivery lock (`drain`).
- **Governed lifecycle:** session JSON + status timeline + watcher notification scheduling (`writeRecord`).
- **Reparent:** session parent + old/new watcher rows + pending revocation/restore + both lock families.
- **Runtime bridge:** session JSON + watcher rows + status timeline + pending delivery + both lock families.
- **Installed hook generation:** source hook assets + packed copies + materialized project copies; source-only deletion is
  not a cutover.

### G.5 Design omissions and blocking contradictions

1. **Session identity has three incompatible current-state claims.** `session-protocol/spec.md` requires universal
   immutable `session.json`; `session-runtime/spec.md` says self-launch has none; the concept-map spec puts identity in
   the adopter database. M1 must select one authority and update all three before governed code.
2. **Cursor deletion has no replacement contract.** The proposed "consumer-owned cursor" describes today's file but
   omits restart semantics. M1 must state durable no-loss or at-least-once replay behavior.
3. **M6-before-M7 is not executable as written.** Deleting legacy readers in M6 destroys M7's input codec. The importer
   and equality proof must be built before M6; only its isolated invocation may remain for M7.
4. **`record lock` is not one queue lock.** It fences Git/worktree creation, harness launch, resource manifests and
   other external effects that SQLite cannot serialize. The roadmap must split those responsibilities before naming
   the lock root deletable.
5. **Timeline is four authorities disguised as one log.** User message history, lifecycle history, follow position and
   private dispatch settlement have different owners and retention. The target schema currently accounts only for the
   first two incompletely.
6. **Sender revocation is absent from the target model.** Removing `.revoked-senders` without a transactional close/send
   rule can deliver stale debt after close.
7. **Observer demolition is over-broad.** Communication cannot depend on `fs.watch`, but dashboard graph freshness still
   needs a DB signal/reconciliation path and Git/project watchers remain legitimate.
8. **Runtime-session's claimed external last consumer is not evidenced.** At this base there is no production caller,
   and the parent worktree contains no implementation. M5 must establish the real installed-adopter contract rather
   than preserve the bridge on assumption.
9. **Runtime artifacts and locks are under-specified.** PID identity, rendezvous stamps, Codex generation state,
   candidate reservations, files/web manifests, close ledger and quarantine are real adopter state. A blanket
   "session files and locks to SQLite" would move platform policy into protocol or break external-effect fencing.
10. **Two live compatibility paths are missing from the roadmap.** `rvSock` accepts an unstamped legacy `/tmp` socket,
    and hook dispatch/doctor accept the global pre-slot manifest. Both need migration gates and M8 deletion proofs.
11. **Generated and shipped copies are a separate deletion surface.** `dist`, packed hook assets and already
    materialized project plugins can retain `session.json` lookup after TypeScript imports reach zero. Tarball and real
    hook traces are required.
12. **There is no current storage-generation switch or protocol DB locator.** M1/M2 must introduce one resolved absolute
    DB path without creating a permanent alias or dual-read mode.
