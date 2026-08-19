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
