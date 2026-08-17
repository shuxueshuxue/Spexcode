# Session communication architecture concept map

Status: review worksheet. This document does not change the accepted specification until each disputed item is
reviewed and the resulting decisions are written back to the spec tree.

Baseline: `8025691eb` (`session-protocol`, `session-topology`, and `session-runtime`).

## Review method

This worksheet first lists the complete candidate set, then tests every element independently.

- **KEEP**: removing the element breaks a stated invariant or forces the same mechanism to be reimplemented.
- **MOVE**: the element is useful, but its current layer is wrong.
- **REMOVE**: no independent value remains after another retained element provides the same fact or behavior.
- **OPEN**: the element may be useful, but current evidence does not justify making it shared or public.

The checkbox is for human review. A checked box means the recommendation and its proof are accepted; a comment
may replace either. Names in this document use standard queueing, event-log, transaction, topology, and adapter
terminology.

## Concept map

```text
SpexCode config resolver (or another adopter's resolver)
  +-- explicit option / environment / global config / OS default
  +-- stateRoot + project namespace --> absolute sessionRoot
  |
Adopter-resolved absolute session root
  |
  +-- openSessionProtocol(sessionRoot) --> SessionProtocol instance
  |       |
  |       +-- initialize(sessionId) -----> protocol.json
  |       +-- enqueue(request) ----------> protocol lock -> events.ndjson -> pending.json
  |       +-- dequeue(sessionId) --------> protocol lock -> events.ndjson -> pending.json
  |       +-- listPending / hasPending --> pending.json
  |       +-- readMessages(cursor) ------> events.ndjson
  |       +-- deleteAddress(sessionId) --> protocol-owned files, only under the protocol lock
  |
  +-- adopter topology
  |       +-- attach / detach / reparent / subscribe
  |       +-- relation queries ----------> adopter policy -> transactional outbox -> enqueue
  |
  +-- adopter runtime
  |       +-- protocol.dequeue ----------> MessageHandler -> HarnessRuntimeAdapter
  |       +-- poll / wake hint / retry --> latency and adapter policy, not protocol truth
  |
  +-- materialization
          +-- HarnessMaterializeAdapter -> contract, hook, trust, skill, and command files
```

There is deliberately no arrow from a filesystem observer to correctness. An observer may wake a runtime, but
the runtime always reads durable protocol state after waking.

## A. Durable files and directories

| Review | ID | Element | Decision | Independent usefulness proof |
|---|---|---|---|---|
| [ ] | F01 | Explicit absolute session root | **KEEP** | All processes need one deterministic namespace for exact session addresses. The adopter resolves and passes the root; the protocol neither assumes `.spexcode` nor derives placement from `cwd`, Git, or a product config file. |
| [ ] | F02 | Per-session protocol directory | **KEEP** | It scopes the marker, queue projection, and log to one exact target and permits a recordless self-launched session. |
| [ ] | F03 | `protocol.json` participation marker | **KEEP** | Directory existence is already used by unrelated Spex sentinels. A versioned marker distinguishes a valid protocol address from a typo or unrelated directory and provides a schema-version check. |
| [ ] | F04 | `events.ndjson` append-only operation log | **KEEP** | `message-enqueued` and `message-dequeued` records are the write-ahead authority for recovery and idempotency. Without an append-only authority, a crash between whole-file rewrites is ambiguous. |
| [ ] | F05 | `pending.json` FIFO materialized view | **KEEP** | Dequeue and `hasPending` remain proportional to current backlog rather than total history. It is reconstructible from F04 but avoids an O(history) scan on every operation. |
| [ ] | F06 | Separate protocol `timeline.ndjson` | **REMOVE** | F04 already contains every immutable message and timestamp needed for communication history. A second append-only message history duplicates authority. Product lifecycle history remains a separate Spex concern. |
| [ ] | F07 | Protocol-owned `cursors.json` | **REMOVE** | A log read can return an opaque cursor. Persisting which reader follows which target is consumer or topology state; it is not required to enqueue, dequeue, recover, or read the log. |
| [ ] | F08 | External per-session protocol lock file | **KEEP** | Independent processes must serialize marker, journal, and queue mutations. Keeping the lock outside the removable session directory fences stale writers during deletion. |
| [ ] | F09 | Separate record lock and delivery lock inside protocol | **REMOVE** | The second lock existed because legacy drain held a lock across an adapter callback. Pure dequeue has no callback, so one protocol lock per address is simpler and sufficient. Spex lifecycle keeps its own governance lock outside this package. |
| [ ] | F10 | Atomic-replace temporary file | **KEEP** | `pending.json` and `protocol.json` must change from one valid version to another without exposing partial JSON. The temporary file is ephemeral and removed or overwritten after recovery. |
| [ ] | F11 | Per-message receipt files | **REMOVE** | Event-log entries already bind message id, idempotency key, payload digest, and transition. Separate receipts create a second recovery authority. |
| [ ] | F12 | Journal segment directory and mutable segment manifest | **REMOVE for v1** | No measured scale currently requires segmentation. A manifest adds crash and ordering states. Add immutable numbered segments only after journal size is measured; never add a mutable manifest. |
| [ ] | F13 | Journal checkpoint or compaction file | **OPEN** | It may bound recovery time after long operation, but F05 already makes ordinary operations cheap. Add only after recovery cost is measured against journal length. |
| [ ] | F14 | Sender-revocation marker | **MOVE to Spex governance** | Revoking a closed coordinator's unhandled commands is Spex lifecycle policy. Z-Storm and self-launch need not share it, so it cannot be protocol truth. |
| [ ] | F15 | `session.json` | **MOVE to adopter governance** | It remains useful for Spex board lifecycle and external runtime projection, but a recordless self-launch address proves it is not protocol participation. |
| [ ] | F16 | `watchers.json` | **MOVE to Spex topology policy** | Manual/parent watch sources and initial-state suppression are real Spex relationships. They are neither queue state nor a universal parent/child format. |
| [ ] | F17 | Transactional topology outbox | **KEEP, adopter-owned** | A relation or state revision may commit before its recipient messages. The outbox closes that crash boundary and prevents a short-lived hook process from losing a fire-and-forget notification. It must share the adopter's topology/state transaction, so it has no universal protocol file format. |
| [ ] | F18 | Z-Storm `unread/*.json` and `read/*.json` mailboxes | **REMOVE after migration** | They implement the same ownership transfer as protocol dequeue. Retaining both would create two queues and two recovery languages. |
| [ ] | F19 | Spex legacy `timeline.ndjson` and `timeline/*.ndjson` | **MOVE to compatibility reader** | Existing bytes are durable user history and cannot be discarded. New protocol messages should use F04; Spex lifecycle events may keep their product event log. |
| [ ] | F20 | `launch`, `launch.proof`, and `launch.sh` | **MOVE to Spex runtime/governance** | They preserve first-turn payload and launch recovery. They are necessary for managed launch but have no role in generic message enqueue or dequeue. |
| [ ] | F21 | `agent.pid`, `agent.identity.json`, and `rv.path` | **MOVE to HarnessRuntimeAdapter** | They prove an exact operating-system process or native input channel. Protocol delivery must not interpret process identity. |
| [ ] | F22 | Native socket, app-server endpoint, or runtime command queue | **MOVE to HarnessRuntimeAdapter** | These are the actual input transports after dequeue. Their presence and acknowledgment cannot change protocol queue semantics. |
| [ ] | F23 | Generated `AGENTS.md` / `CLAUDE.md` contract block | **MOVE to HarnessMaterializeAdapter** | It gives self-launched and governed agents the same project contract without requiring a backend. It is setup, not runtime delivery state. |
| [ ] | F24 | Generated hook shim files (`.codex/hooks.json`, `.claude/settings.json`, OpenCode plugin, Pi extension) | **MOVE to HarnessMaterializeAdapter** | Harnesses discover different files, so an adapter must own placement and bytes. The protocol only receives the session id produced by those hooks. |
| [ ] | F25 | Materialization manifest, selection allowlist, trust block, skills, commands, and agent definitions | **MOVE to HarnessMaterializeAdapter** | They are required to make hooks and capabilities discoverable, but none participates in queue transactions. |
| [ ] | F26 | Spec-discipline sentinels such as `spec-checked` and `spec-of-file-seen` | **OUT OF SCOPE** | They share a session directory but are unrelated one-shot product state. Their coexistence is the reason F03 cannot be replaced by directory existence. |
| [ ] | F27 | Session files/web/evidence manifests | **OUT OF SCOPE** | They are user artifacts and review surfaces, not communication queue state. |
| [ ] | F28 | SpexCode global config file | **KEEP, adopter-owned** | Persistent user preference such as `stateRoot` needs one machine-level source that is independent of any repository and readable before a project or session exists. It is not a protocol file. |
| [ ] | F29 | Explicit global config-file locator | **KEEP** | A user must be able to relocate the config file itself. A CLI/API option and `SPEXCODE_CONFIG_FILE` solve this bootstrap problem without asking the config file to locate itself. |
| [ ] | F30 | `stateRoot` field in global config | **KEEP** | It relocates the durable SpexCode store, including projects and sessions, without changing the protocol layout or patching downstream code. |
| [ ] | F31 | OS-standard config and state defaults | **KEEP** | Defaults remain zero-configuration without making `$HOME/.spexcode` part of the product contract. On Unix, XDG distinguishes configuration from persistent application state. Other platforms use their native per-user directories. |
| [ ] | F32 | Configurable pathname for every protocol file | **REMOVE** | Configuring `pending.json`, the event log, and locks independently would make the wire layout variable and untestable. Only the root is configurable; the versioned relative layout below it is fixed. |
| [ ] | F33 | Required `$HOME/.spexcode` directory | **REMOVE as a requirement; KEEP as compatibility default/override** | The current default is useful for compatibility, and `SPEXCODE_HOME` already relocates it. Treating the literal directory as protocol identity would lock external adopters to SpexCode. |
| [ ] | F34 | Resolved-root propagation to child processes and hooks | **KEEP, adopter-owned** | A CLI flag exists only in the invoking process. Managed children and short-lived hooks must receive the already resolved root explicitly, currently through `SPEXCODE_HOME`, or they may write to a different store. |

## B. Packages and modules

| Review | ID | Element | Decision | Independent usefulness proof |
|---|---|---|---|---|
| [ ] | P01 | `@spexcode/session-protocol` published package | **KEEP** | Independent runtimes must share one codec, lock order, file layout, and recovery implementation. Publishing prevents each adopter from reimplementing the protocol. |
| [ ] | P02 | `@spexcode/spec-core` layout dependency | **REMOVE from protocol** | Storage placement is adopter configuration, not wire semantics. Requiring spec-core would make every adopter inherit SpexCode's `.spexcode/projects/...` layout and reintroduce vendor lock-in. SpexCode may call spec-core before constructing the protocol. |
| [ ] | P03 | `@spexcode/session-core` package | **KEEP temporarily, then REMOVE** | A compatibility re-export avoids an immediate breaking release. It has no permanent independent responsibility once consumers import P01. |
| [ ] | P04 | `session-topology` architectural module | **KEEP** | Recipient resolution and relationship invariants must live outside both queue mechanics and harness effects. Without this boundary, parent/watch policy leaks into protocol. |
| [ ] | P05 | Published `@spexcode/session-topology` package | **OPEN; do not publish yet** | Spex and Z-Storm currently persist and interpret different relationships. Publish only after two adopters demonstrate identical semantics and wire needs. |
| [ ] | P06 | Shared `session-runtime` package or class | **REMOVE** | The three adopters have different triggers, liveness, topology, and input transports. A universal runtime would contain policy switches. Keep `session-runtime` as an architectural composition, implemented by each adopter. |
| [ ] | P07 | Spex governed runtime | **KEEP, adopter-owned** | It owns board lifecycle, topology policy, managed processes, immediate dequeue attempts, and bounded durable-state sweeps. |
| [ ] | P08 | Z-Storm runtime | **KEEP, adopter-owned** | It already owns the model loop, steering, deferred input, subagent registry, and multi-workspace process. The protocol is one injected port. |
| [ ] | P09 | Self-launch listener command | **KEEP, adopter-owned surface** | With no resident backend, an explicit foreground/background command is the only process that can dequeue and hand messages to the native harness. |
| [ ] | P10 | `runtime-session.ts` public bridge | **REMOVE after migration** | It combines Spex record fields, topology, lifecycle projection, notification text, and enqueue. Each responsibility has a retained owner elsewhere. |
| [ ] | P11 | `@spexcode/session-core/internal` public subpath | **REMOVE from published contract** | External callers should never compose partial queue transactions. Spex may use private workspace modules during migration, but a published internal entry makes unsupported half-operations look stable. |
| [ ] | P12 | Filesystem observer service | **REMOVE as shared architecture** | `fs.watch` cannot guarantee one event per write and scales with observers x subjects. Adopters may use one as a latency hint, but no shared observer owns truth. |
| [ ] | P13 | Bounded polling or event-loop wake strategy | **MOVE to adopter runtime** | It affects latency and resource cost, not file semantics. Spex, self-launch, and Z-Storm have different process lifetimes. |
| [ ] | P14 | SpexCode path/config resolver module | **KEEP, adopter-owned** | It resolves config location, state root, project namespace, and the exact session root once. Centralizing precedence prevents the CLI, backend, hooks, and dashboard from disagreeing. |
| [ ] | P15 | Generic configuration package inside `session-protocol` | **REMOVE** | Z-Storm, embedded consumers, and SpexCode need different configuration sources. The protocol needs an absolute path, not a global configuration framework. |

## C. Public data types and interfaces

Classes are not preferred by default. A factory returning an interface is enough unless inheritance or mutable
object identity buys behavior.

| Review | ID | Element | Decision | Independent usefulness proof |
|---|---|---|---|---|
| [ ] | T01 | `SessionProtocol` interface | **KEEP** | It binds one explicit session root and exposes the coherent operation set without global cwd or environment mutation. |
| [ ] | T02 | `openSessionProtocol({ sessionRoot })` factory | **KEEP** | It validates and freezes one absolute filesystem root, so a multi-workspace process can hold independent protocol instances. A class constructor adds no value. |
| [ ] | T03 | `SessionId` | **KEEP as validated string** | It is the address key and pathname component. Validation prevents traversal but must not require a Spex- or Z-Storm-specific prefix. A branded class is unnecessary. |
| [ ] | T04 | `EnqueueRequest` | **KEEP** | Producer input does not yet have protocol-generated `messageId` and `enqueuedAt`; separating it from the stored Message prevents callers from forging authority fields. |
| [ ] | T05 | `Message` | **KEEP** | One immutable envelope is the common language: version, messageId, optional senderSessionId, content, enqueuedAt, optional headers. The queue address already supplies the target. |
| [ ] | T05a | Stored `targetSessionId` in every Message | **REMOVE** | `enqueue` already receives the exact target and the per-session directory is authoritative. Repeating it creates two target truths; multi-session consumers already know which address they dequeued. |
| [ ] | T06 | Dedicated `MessageHeaders` class | **REMOVE** | `Readonly<Record<string, string>>` supplies the needed opaque extension point without methods, inheritance, or another codec. |
| [ ] | T07 | `IdempotencyKey` input field | **KEEP** | A producer retry after uncertain completion must bind to the first immutable payload; changed reuse must fail. It is not a separate receipt type. |
| [ ] | T08 | `ProtocolEvent` tagged union | **KEEP, private** | Recovery must distinguish `message-enqueued` from `message-dequeued` and validate versioned bytes. Callers need Messages, not internal operation records. |
| [ ] | T09 | `LogCursor` opaque value | **KEEP** | Incremental history readers need a stable next position without persisting follow relationships in the protocol. |
| [ ] | T10 | `PendingQueue` public class | **REMOVE** | Queue representation is an implementation detail. Public mutation methods would bypass journal invariants. |
| [ ] | T11 | `SessionProtocolError` with stable error-code union | **KEEP** | Adopters must distinguish not-initialized, corrupt-state, idempotency-conflict, lock-timeout, and non-empty-delete without parsing prose. One error class is sufficient. |
| [ ] | T12 | One error subclass per failure | **REMOVE** | Stable codes on T11 provide machine handling. Multiple classes add exports without different recovery behavior. |
| [ ] | T13 | `MessageHandler = (message) => Promise<void>` | **KEEP, adopter runtime** | It is the narrow ownership handoff from protocol message to native runtime. It does not belong in protocol or run under the protocol lock. |
| [ ] | T14 | Optional handler journal keyed by `messageId` | **KEEP only where required** | An adopter needing retry after dequeue must own that stronger guarantee. Self-launch or Z-Storm may accept at-most-once and omit it. |
| [ ] | T15 | `HarnessRuntimeAdapter` | **KEEP** | It owns launch, native input, interrupt, stop, liveness, and native identity without exposing harness differences to product policy. |
| [ ] | T16 | `HarnessMaterializeAdapter` | **KEEP** | It owns contract, hook, trust, skills, commands, and file placement. It allows self-launch setup without importing a managed runtime. |
| [ ] | T17 | One combined `HarnessAdapter` interface | **REMOVE after split** | The current interface mixes setup, runtime, transcript, lifecycle, and cleanup capabilities. Consumers are forced to depend on methods they never call. |
| [ ] | T18 | `TopologyEdge` and `TopologyRevision` | **KEEP inside topology** | Attach/reparent and recipient replay require stable relation identity independent of message ids. |
| [ ] | T19 | `RecipientSet` | **KEEP as return value, not stored class** | A topology query must return exact addresses to enqueue. A plain immutable set is sufficient. |
| [ ] | T20 | `OutboxEntry` | **KEEP, adopter-private** | It binds one committed topology/state revision to intended recipient messages until all idempotent enqueues complete. |
| [ ] | T21 | `RuntimeSessionRegistration`, `RuntimeSessionState`, `RuntimeSessionRecord`, `RuntimeSessionNotification` | **MOVE to Z-Storm/Spex compatibility adapter, then reduce** | They currently encode adopter projection. None is required by self-launch or generic queue operations. |
| [ ] | T22 | `PendingMessage`, `PreparedMessage`, `AcceptMessageOptions`, `MessageIdempotency` | **REMOVE after protocol migration** | T04/T05/T07 replace them without product callbacks or receipt internals in the public wire language. |
| [ ] | T23 | Protocol-persisted `Cursors` follow map | **REMOVE** | T09 supplies incremental reads; parent/manual follow registration is topology/product policy. |
| [ ] | T24 | Product `TimelineEvent` containing lifecycle/proposal/note | **MOVE to Spex lifecycle log** | It is useful for the dashboard and declarations but cannot be the adapter-neutral message journal. |
| [ ] | T25 | SpexCode `ResolvedPaths` value | **KEEP, adopter-private** | An immutable resolved value lets all SpexCode subsystems share the same config file, state root, project root, and session root without rereading mutable process environment. |
| [ ] | T26 | Generic `StorageProvider` interface | **REMOVE for v1** | Every accepted adopter uses the filesystem, and the user requirement is path relocation rather than a database/object-store abstraction. Add a provider interface only when a real adopter cannot use files. |

## D. Operations and transaction boundaries

| Review | ID | Element | Decision | Independent usefulness proof |
|---|---|---|---|---|
| [ ] | O01 | `initialize(sessionId)` | **KEEP** | It creates an exact versioned participant before any sender can target it and separates self-launch participation from governance. |
| [ ] | O02 | `enqueue(request)` | **KEEP** | It is the sole producer transaction: validate marker, append journal authority, update pending view, and return the immutable Message. |
| [ ] | O03 | `dequeue(sessionId)` | **KEEP** | It is the sole ownership-transfer transaction: record dequeued, remove FIFO head, and return Message or null. No adapter callback runs under the lock. |
| [ ] | O04 | Public `drain(callback)` | **REMOVE** | It couples queue ownership to adapter success and recreates the old mixed boundary. |
| [ ] | O05 | Public `drain(limit)` or `dequeueMany(limit)` convenience | **REMOVE initially** | Every adopter has different limits, cancellation, and stop conditions; a small caller loop is clearer than another public semantic. Add only after identical usage is measured. |
| [ ] | O06 | `listPending(sessionId)` | **KEEP** | Diagnostics and runtimes need an ordered non-mutating queue view. It must validate corruption rather than filter invalid rows. |
| [ ] | O07 | `hasPending(sessionId)` | **KEEP** | Hot sweeps need a cheap backlog predicate without allocating the full list. Corrupt state returns an error, not false. |
| [ ] | O08 | `readTimeline` name | **REMOVE from protocol vocabulary** | The one retained physical source is an event log, and the public result is Messages. Prefer standard `readMessages(cursor)`; Spex may continue to call its product view a timeline. |
| [ ] | O09 | `readMessages(cursor)` | **KEEP** | It exposes immutable communication history derived from the journal without exposing transaction entries. |
| [ ] | O10 | Public `reconcile(sessionId)` | **REMOVE as a required caller step** | A self-contained package must recover before every mutation/open. Requiring callers to remember reconcile creates an invalid state in which normal APIs are unsafe. |
| [ ] | O11 | Private automatic recovery | **KEEP** | It rebuilds pending from journal after crashes and validates that projection and authority agree before operations continue. |
| [ ] | O12 | `deleteAddress(sessionId)` | **KEEP; missing from baseline** | The package owns protocol address files and locks, so it must provide bounded deletion without implying deletion of a governed session. Default behavior refuses a non-empty queue; adopter governance decides when to call it. |
| [ ] | O13 | Public raw lock helpers | **REMOVE** | Exposing locks lets callers mutate files without journal rules. Cross-module work uses idempotency and outboxes rather than a shared half-transaction API. |
| [ ] | O14 | `enqueueMany` atomic batch | **REMOVE** | Atomic writes across recipient directories are not available. Topology outbox plus idempotent individual enqueue gives explicit partial-progress recovery. |
| [ ] | O15 | `attach`, `detach`, `reparent`, `parents`, `children` | **KEEP in topology** | They are the shared relation vocabulary and can be exercised without sending a message. |
| [ ] | O15a | `subscribe`, `unsubscribe` | **OPEN; adopter policy for now** | Spex has proved manual subscriptions, but Z-Storm has not proved identical semantics. Keep them outside a shared topology contract until a second adopter needs them. |
| [ ] | O15b | `recipients()` in neutral topology | **REMOVE** | Relations are topology facts; deciding which relation receives which state transition is runtime/governance policy. The adopter queries relations and constructs the recipient set. |
| [ ] | O16 | `notifyParent` or `publishWorking` | **REMOVE as shared operations** | They combine product state, topology, message composition, and enqueue. Spex/Z-Storm runtime composition performs those steps explicitly. |
| [ ] | O17 | Immediate wake hint after enqueue | **MOVE to adopter runtime** | It reduces latency when producer and runtime can communicate, but the message remains correct without it. |
| [ ] | O18 | Bounded durable-state sweep | **KEEP in long-lived runtimes** | It recovers from missed hints and backend replacement. It reads `hasPending`/dequeue; it does not infer writes from timestamps. |
| [ ] | O19 | Filesystem event as delivery signal | **REMOVE** | Filesystem events may be delayed, coalesced, duplicated, or lost. They cannot prove a queue transition. |
| [ ] | O20 | Materialize / dematerialize | **KEEP in setup layer** | They install and remove adapter-discovered files idempotently without participating in message operations. |
| [ ] | O21 | Resolve SpexCode paths once at process startup | **KEEP, adopter-owned** | One deterministic precedence chain yields an immutable absolute root before any store access. Re-resolving environment or config during an operation could split one process across roots. |
| [ ] | O22 | Search and merge multiple state roots | **REMOVE** | Reading both `.spexcode` and a configured state root would create two authorities and ambiguous deletion. Exactly one root is active; migration is an explicit operation. |

## E. Transaction rules

| Review | ID | Element | Decision | Independent usefulness proof |
|---|---|---|---|---|
| [ ] | X01 | Marker publication by atomic rename | **KEEP** | It gives initialize one linearization point; enqueue before it fails not-initialized and enqueue after it may proceed. |
| [ ] | X02 | Enqueue event-first, pending-second | **KEEP** | A crash after authority but before projection is repairable by replaying the full Message from the event log. The opposite order could expose an unauthoritative queue row. |
| [ ] | X03 | Dequeue event-first, pending-second | **KEEP** | A crash after the dequeued event leaves a removable pending residue and never duplicates ownership transfer. |
| [ ] | X04 | At-most-once ownership transfer | **KEEP** | It makes the protocol closed: after dequeue commits, adapter behavior cannot mutate queue truth. Stronger native-delivery guarantees are adopter-local. |
| [ ] | X05 | Idempotent enqueue | **KEEP** | It handles producer uncertainty without duplicates and rejects one key bound to different bytes. |
| [ ] | X06 | Strict decode with absent/empty/corrupt distinction | **KEEP** | Corrupt-as-empty is silent message loss and permits later writes to overwrite evidence. |
| [ ] | X07 | Lock owner PID plus process start token | **KEEP** | PID alone may be reused. The start token distinguishes the original dead owner from an unrelated live process. |
| [ ] | X08 | Global lock order across multiple addresses | **REMOVE from public design** | No retained public operation locks multiple addresses. Individual idempotent enqueue avoids deadlock-prone cross-address transactions. |
| [ ] | X09 | Transactional topology outbox | **KEEP in adopter store** | It guarantees eventual enqueue for a committed relation/state revision without relying on a short-lived process or observer. |
| [ ] | X10 | Adapter callback while holding protocol lock | **REMOVE** | It creates deadlock/reentrancy risk and makes queue semantics depend on a native transport. |
| [ ] | X11 | Automatic recovery on open/mutation | **KEEP** | It makes every public operation safe without a caller-maintained startup checklist. |
| [ ] | X12 | Automatic journal compaction | **OPEN** | It spends complexity before recovery cost is measured. Pending already bounds the hot path; defer compaction until evidence shows need. |
| [ ] | X13 | File and parent-directory `fsync` in the storage primitive | **KEEP if the package claims host-crash durability** | Atomic rename alone proves visibility across process failure, not persistence across host or power loss. Centralized sync contains the platform-specific complexity. Otherwise the public contract must explicitly promise only process-crash recovery. |

## F. Current `@spexcode/session-core` export disposition

This table ensures migration does not hide old public concepts.

| Current export | Disposition |
|---|---|
| `acceptMessage` | Replace with pure `enqueue`; validation and prompt preparation move to producer. |
| `MessageKeyConflict` | Fold into `SessionProtocolError` code `idempotency_conflict`. |
| `AcceptMessageOptions`, `PreparedMessage`, `MessageIdempotency` | Remove; replace with `EnqueueRequest` and `idempotencyKey`. |
| `drain` | Remove callback form; consumers call `dequeue`. |
| `owesDelivery` | Rename `hasPending`. |
| `pendingMessages`, `PendingMessage` | Rename `listPending`, returning `Message[]`. |
| `registerRuntimeSession`, `publishRuntimeSessionState` | Remove from protocol; adopter runtime plus topology outbox. |
| `readRuntimeSession`, `runtimeSessionChildren`, `runtimeSessionNotification` | Move to adopter projection/topology. |
| `RuntimeSession*` types and `RuntimeSessionConflict` | Move to compatibility adapter; do not publish as universal types. |
| `readCursors`, `followCursor`, `advanceFollow`, `followedSessions`, `Cursors` | Move to Spex follow/topology. |
| `unreadSince` | Retain only as a pure product log helper if Spex still needs it; not protocol state. |
| `timelineEvents`, `timelineTail`, `timelineStamp` | Replace protocol message reads with `readMessages`; keep Spex product timeline readers in Spex. |
| `recordStatus` | Move to Spex lifecycle log. |
| `lastHumanSendVia`, `currentHumanTurn`, `SessionTurn` | Move to Spex conversation projection. |
| `TimelineEvent` | Split generic Message from Spex lifecycle event. |
| `enqueue`, `ensurePendingWhileLocked`, `pendingSnapshot`, `replacePendingWhileLocked` | Replace with private journal-backed queue projection functions. |
| `revokePendingFromWhileLocked`, `revokeSenderDelivery`, `senderDeliveryRevoked` | Move to Spex close/reparent governance. |
| `withDeliveryLocks` | Replace with one private protocol lock. |
| `appendSent`, `sentDispatchReceipt`, `settleSentDispatch`, receipt types | Replace with private journal append/read; no separate settlement vocabulary. |
| `trySessionRecordLockSync`, `withSessionRecordLock*` | Move governance record locks to Spex; protocol keeps only its private address lock. |
| `@spexcode/session-core/internal` | Delete after Spex migration. |

## G. Adopter composition proof

| Element | Z-Storm | Self-launch | Spex governed |
|---|---|---|---|
| Explicit session-root protocol instance | Resolved by the Z-Storm host | Resolved by the listener/bootstrap command | Resolved by SpexCode config plus project namespace |
| `initialize` | At root/child id creation | SessionStart hook | Governed create before publication |
| `enqueue` producer | Z-Storm topology/command layer | Any process with exact initialized id | CLI, hook, API, topology outbox |
| `dequeue` consumer | Existing injected mailbox port | Explicit listen/monitor/background command | Spex runtime loop/backend |
| Topology | Z-Storm session/subagent store | None required | Spex parent/manual watch policy |
| Runtime adapter | steer/deferred-input/model loop | Harness-specific command/input seam | Spex harness runtime registry |
| Materialization adapter | Z-Storm config if adopted | Required for zero-friction hooks/listener | Same setup plus governed launch |
| Resident backend | Z-Storm app-server | Not required | Optional for correctness, useful for latency/resources |
| Filesystem observer | Optional hint only | Optional hint or bounded poll | Optional hint; bounded sweep repairs missed hints |

All three use the same marker, Message codec, journal, pending view, lock, enqueue, and dequeue. No row in the
protocol envelope identifies the adopter.

## H. Proposed minimal design after subtraction

### Published package

```ts
interface SessionProtocol {
  initialize(sessionId: string): Promise<void>
  enqueue(request: EnqueueRequest): Promise<Message>
  dequeue(sessionId: string): Promise<Message | null>
  listPending(sessionId: string): Promise<readonly Message[]>
  hasPending(sessionId: string): Promise<boolean>
  readMessages(sessionId: string, cursor?: LogCursor): Promise<{
    messages: readonly Message[]
    cursor: LogCursor
  }>
  deleteAddress(sessionId: string): Promise<void> // refuses a non-empty queue
}

function openSessionProtocol(options: { sessionRoot: string }): SessionProtocol
```

Internal automatic recovery runs before mutations. There is no public lock, adapter callback, watcher,
reconcile requirement, parent relation, lifecycle enum, or native identity.

### Durable protocol files

```text
<session-root>/<session-id>/
  protocol.json
  events.ndjson
  pending.json          # absent when empty

<session-root>/.locks/
  <encoded-session-id>.lock
```

### Remaining layers

- Topology stays an internal architectural module until two adopters prove shared semantics.
- Runtime is adopter-owned composition, not a shared package or base class.
- Runtime and materialization are separate adapter facets.
- `@spexcode/session-core` and `runtime-session.ts` are migration-only compatibility surfaces.

## I. Storage location and global configuration

### Boundary

The fixed path `$HOME/.spexcode` is a current SpexCode default, not part of the session communication protocol.
The protocol package receives one absolute `sessionRoot` and owns only the versioned relative layout below it.
It does not read `SPEXCODE_HOME`, XDG variables, a repository config, Git metadata, or a global config file.

SpexCode has a separate path resolver. It maps machine-level configuration plus a project identity to the exact
session root, then injects that root into `openSessionProtocol`. Z-Storm and an embedded adopter can use their own
resolvers. This keeps one file language while allowing different physical locations.

### Current SpexCode state

SpexCode is not completely locked to the literal directory today. `packages/spec-core/src/project-store.ts`
already resolves `SPEXCODE_HOME` before falling back to `$HOME/.spexcode`, and tests use that override for
isolation. However, `packages/spec-core/src/project-identity.ts` stores the host config at
`<SPEXCODE_HOME>/config.json`. That file cannot configure the location of `SPEXCODE_HOME`, because its location
must already be known before it can be read. Shell hooks also repeat the environment/default calculation. The
remaining design problem is therefore not adding arbitrary paths to the protocol; it is separating config
bootstrap from state placement and resolving the result once for every process.

### Recommended resolution order

Resolve the global config file first:

1. an explicit embedding/CLI config-file option;
2. `SPEXCODE_CONFIG_FILE`;
3. the OS user-config default, such as `$XDG_CONFIG_HOME/spexcode/config.json` or
   `$HOME/.config/spexcode/config.json` when XDG is unset.

The global config file may contain `stateRoot`, but it cannot redirect its own location. That single restriction
keeps bootstrap deterministic.

Then resolve the SpexCode state root:

1. an explicit embedding/CLI state-root option;
2. the existing `SPEXCODE_HOME` environment variable;
3. `stateRoot` in the resolved global config;
4. the OS user-state default, such as `$XDG_STATE_HOME/spexcode` or `$HOME/.local/state/spexcode` when XDG is
   unset.

During migration, an existing `$HOME/.spexcode` remains a supported legacy root. The resolver must select exactly
one root and expose it; it must not silently merge or copy two stores. A dedicated migration command can later
move data under locks and write the selected `stateRoot` to global config.

The result is resolved once to absolute paths and frozen:

```ts
type ResolvedPaths = {
  readonly configFile: string
  readonly stateRoot: string
  readonly projectRoot: string
  readonly sessionRoot: string
}
```

Long-lived backends receive this value directly. Child processes and generated hooks receive the resolved state
root through their launch environment, preserving `SPEXCODE_HOME` compatibility. They do not independently
repeat precedence logic. The protocol package still receives only `sessionRoot`.

### Why this is a standard design

The [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/) separates
user configuration (`XDG_CONFIG_HOME`), persistent application state (`XDG_STATE_HOME`), cache, data, and
ephemeral runtime files. Session queues and logs are state, not config and not cache. Runtime sockets may use an
OS runtime directory, but durable queue files must not because runtime directories may be cleaned.

[Git](https://git-scm.com/docs/git-config) supports XDG configuration and lets
`GIT_CONFIG_GLOBAL` replace the normal global config files. [Docker](https://docs.docker.com/reference/cli/docker/)
uses the same explicit-option-over-environment-over-file pattern with `--config` and `DOCKER_CONFIG`. The proposed
SpexCode resolver follows these established mechanisms instead of making `.spexcode` a universal protocol path.

### Rejected alternative

A general `StorageProvider` or configurable path for every file would reduce interoperability rather than vendor
lock-in: two adopters could claim the same protocol while using incompatible storage semantics and layouts. Root
injection is the smaller boundary. It permits any filesystem location while keeping atomic replace, locking,
event ordering, recovery, and relative filenames fixed and testable.

## J. Decisions that need explicit human review

1. Is one append-only operation log allowed to serve both recovery authority and immutable message history, removing the separate
   protocol timeline file?
2. Should cursor persistence leave the protocol entirely, with `readMessages` returning only an opaque cursor?
3. Should recovery be automatic and private, removing public `reconcile`?
4. Should the first public API omit batch drain/dequeue and expose only singular `dequeue`?
5. Should `deleteAddress` be part of the package, with non-empty deletion refused by default?
6. Should topology remain unpublished until Spex and Z-Storm prove identical relation semantics?
7. Should the current combined Harness interface split into runtime and materialization facets before the Spex
   adopter migrates?
8. Should SpexCode retain `SPEXCODE_HOME` as the compatibility override while adding an explicit config-file
   override and XDG defaults, or make the compatibility variable the permanent public name?
