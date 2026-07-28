---
title: session maintenance lease
status: active
hue: 280
desc: A project-scoped admission barrier that drains in-flight session writes, blocks ordinary mutation, and admits only a finite exact stop/resume maintenance plan.
code:
  - spec-cli/src/session-maintenance.ts
related:
  - spec-cli/src/maintenance-wrapper.ts
  - spec-cli/test/session-maintenance-cas-fixture.ts
  - spec-cli/test/session-maintenance-http-fixture.mjs
  - spec-cli/src/session-maintenance.test.ts
  - spec-cli/src/session-maintenance.integration.test.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/client.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/harness.ts
  - spec-cli/src/runtime-ownership.ts
---

# session maintenance lease

## raw source

A project sometimes needs a short, explicit maintenance window in which its session control plane is quiet
while an operator replaces shared infrastructure. Stopping the backend is too blunt: the operator still needs
the product's exact stop/resume paths. Leaving it running is unsafe: a hook, send, queue tick, fallback launch,
or second human can mutate the same sessions between census and cutover. One project-scoped admission barrier
must close that race without becoming a second auth system or a general process controller.

## expanded spec

The maintenance lease is scoped to one project's `runtimeRoot()`. Its durable state machine is exactly
`open -> draining -> active -> open`; the durable open row remains so its epoch never resets. The future
implementation belongs in one module, `spec-cli/src/session-maintenance.ts`; this spec becomes that file's sole
`code:` governor in the implementation checkpoint, when the path exists. Until then its red contract suites are
related here rather than legitimizing a product stub.

### One admission vocabulary

The operation type is a CLOSED discriminated union, never a caller-provided string:

```
create | fallback-create | lifecycle-transition | hook-state | send | raw-key-input |
terminal-input | interrupt | rename | sort | stop | resume | archive | close |
merge-dispatch | queue-drain | attach | shared-spawn
```

Every Spex-owned entry that can write session state or address a session runtime acquires its operation ticket
at the lowest shared side-effect boundary: API and fallback creation, lifecycle writes, hook dispatch, prompt
send, CLI raw keys, browser/xterm input, interrupt, rename/sort, stop/resume/archive/close, merge dispatch,
queue drain, `spex session attach`, and the internal shared-runtime spawn. Reads, including maintenance status,
remain open. A new Spex attach holds one `attach` ticket for the whole foreground tmux client lifetime. An
already-running Spex attach was admitted under the preceding epoch and must drain; a native tmux/Codex client
that bypasses Spex is outside this barrier and remains an explicit runbook census boundary.

Acquisition uses one atomic durable compare-and-swap to change `open` to `draining`, closing ordinary admission
before it enumerates preceding-epoch tickets. Two backend/CLI instances sharing the same runtime root cannot
both win. Once every preceding ticket is proven gone, the same epoch advances to `active`. A bounded acquire
wait only limits how long the request waits and reports the still-live ticket identities; its deadline NEVER
proves that a callback stopped. A ticket whose exact PID/start owner is live, or whose owner identity is
ambiguous, blocks forever regardless of its ticket deadline. Recovery may reclaim only a proven-dead owner or
a PID whose start identity proves reuse. A callback throw always removes its own ticket in `finally`, while
recording that capability attempt as indeterminate; it never strands a falsely-live ticket and never licenses a
retry that could duplicate an unknown side effect.

Lease heartbeat expiry or owner death moves `active` to recovery-draining, invalidates its bearer, and closes
all maintenance capabilities, but NEVER reopens ordinary admission while any live or ambiguous ticket remains.
Only after those tickets drain or their exact owners are proven dead/reused may recovery advance to `open`.
Explicit release likewise refuses while a live/ambiguous ticket exists. There is no force-break of a
non-expired lease and no deadline-based ticket reap.

Any unadmitted write fails before callback, handler, transport, signal, record/file write, queue claim, tmux
client, or spawn. The structured error is exactly `maintenance_active` plus state, epoch, operation and optional
session id; HTTP and CLI preserve it rather than collapsing it into not-found or generic transport failure.
Refusal creates no ticket and changes no durable lease/capability/event state. A hook dispatcher emits the same
structured fail-loud block and invokes zero handlers.

### Exact finite authority

An active lease admits only the finite capability set fixed at acquisition. Each immutable copied entry is
exactly `{op:"stop", sessionId}` or `{op:"resume", sessionId, force}`; duplicate entries are rejected, and the
caller cannot widen them by mutating its input after acquisition. Session id, operation, and resume force all
match exactly. A capability is one-shot: its atomic claim records `inflight(requestId)` and creates at most one
live ticket. A successful callback commits it; a repeated or concurrent request returns
`maintenance_capability_used` without running the callback. A structured pre-admission or product refusal
returns it to unused and may be retried. Network failure, timeout, 5xx, malformed response, or callback throw
marks it `indeterminate`; retry is refused because a side effect may already have happened. Release is still
explicit, but never implies that unused/indeterminate work succeeded.

Canonical shared spawn is not grantable directly. An admitted resume mints a separate opaque, one-use delegated
capability bound to that live resume ticket, epoch, operation, and session id. The nested internal
`shared-runtime-spawn` consumes it while the parent resume ticket is still live, scrubs it before exec, and never
places it in argv, logs, records, events, or comms. Forged, stale-epoch, completed-parent, wrong-session,
wrong-operation, and replayed delegates all fail before spawn. Thus the canonical spawn rides exactly one
admitted resume without opening unrelated launch or queue work. Reading the delegated FIFO and completing its
writer is only bearer handoff, not launch success. The parent resume ticket and active lease remain live until
the harness adapter's launch-readiness proof succeeds. Product code does not commit `stopped:false` or report a
successful resume before that proof; helper refusal, timeout, or an explicit false readiness result returns a
non-success and preserves or restores the retained record as stopped/offline.

### Bearer, durability, and public lifecycle

The lease bearer is 32 cryptographically random bytes encoded opaquely and returned once. The durable row stores
exactly `SHA-256(token)`; verification hashes the presented token and uses a length-normalized constant-time
digest comparison. Neither the raw lease token nor a delegated bearer appears in tickets, events, errors,
URLs/query, argv, session records, timelines, comms, or ordinary logs. HTTP carries the lease token only in
`X-SpexCode-Session-Maintenance`. Normal endpoint authentication and project binding run first and remain
mandatory: maintenance admission is not authentication.

The durable row atomically stores version, state, monotonically increasing epoch, token hash, an immutable
canonical capability copy plus each capability's claim state, exact owner generation, heartbeat deadline, and
tickets containing only id, epoch, closed operation, optional target/force, exact owner PID/start, and reporting
deadline. Release clears the lease material but preserves the epoch; every later acquire increments it. Backend
restart reads and honors `draining`/`active` before serving any write. Heartbeat and release require the exact
current epoch and token; missing token, wrong token, stale token/epoch, malformed TTL, and wrong project all
fail without changing durable state or events. An explicit maintenance header is never ignored merely because
the row is `open`: it must name the one active epoch and exact capability, or it fails before ordinary
stop/resume admission. The production HTTP path and coordinator use this same authorization function.

The lease owner is the exact backend supervisor generation `{instanceId,pid,startToken}`, resolved from the
supervisor-injected instance id and trusted backend-instance registry; acquire input cannot nominate an owner.
Replacing only the backend child preserves a live, unexpired supervisor generation and leaves its draining or
active barrier authoritative. A dead/reused supervisor generation or TTL expiry keeps the existing recovery
rule: revoke bearer and capabilities, enter recovery-draining, and reopen after live tickets drain. This lease
does not add a durable lifetime ticket for the arbitrary operator command, so it does not claim that command
survives supervisor death or expiry; the wrapper instead stops its local command immediately when authority is
lost.

Every coordinator transaction uses one crash-safe lock generation. A complete owner record is written and
fsynced beside the lock, then hard-linked to the fixed lock path as the atomic CAS, so a crash before publication
cannot leave an ownerless canonical lock. Reaping a proven-dead/reused owner first claims a nonce-specific marker;
while it exists no acquirer may publish, and the reaper re-reads the same nonce and exact dead identity before
unlinking. A marker is itself a complete nonce plus exact PID/start owner record. A contender waits on every
live or ambiguous marker; it may reclaim a dead/reused marker only under the same recursive nonce-owned claim,
then re-reads the unchanged marker nonce and owner immediately before unlinking. Thus a reaper crash on either
side of canonical-lock unlink cannot wedge admission or let a later reaper delete a replacement owner. Release
removes only its own nonce.

The public porcelain stays under the existing session noun: `spex session maintain --allow-stop <SEL> ...
--allow-resume <SEL>[:force] ... -- <command...>` is one scoped wrapper, and `spex session maintain --status`
is its sanitized read. There is no seventh CLI noun and no separately typeable acquire/heartbeat/release
sequence that would make shell history the bearer store. The wrapper's authenticated HTTP lifecycle is
`POST /api/session-maintenance/acquire`, `GET /api/session-maintenance`, and POST `heartbeat`/`release` children.
Acquire accepts the finite capabilities, `ttlMs` in `[5000,300000]`, and `waitMs` in `[0,120000]` with
`waitMs <= ttlMs`; it returns `201 active` or, when the bounded wait ends while tickets remain, `202 draining`,
with epoch and the token exactly once to the wrapper's in-memory HTTP client. Status exposes
state/epoch/deadlines/capability states and sanitized lease/ticket owners, never bearer material. Heartbeat
accepts the same finite TTL range. The wrapper keeps the bearer in memory and heartbeats while its command runs.
On normal exit it closes and drains broker admission, reaps the command, then releases its still-current epoch.
Heartbeat/status epoch, state, plan, or owner mismatch closes admission immediately, terminates and boundedly
reaps the local operator command process group, exits nonzero, and never releases or adopts the stale epoch. It
never prints or exports the bearer. Broker HTTP operations carry an explicit completed/refused/indeterminate
outcome rather than inferring capability state from a generic status. Every request has a bounded abort signal;
broker transport loss closes admission and aborts pending HTTP work before command reap. Every path after a
well-formed acquire token and epoch, including response-plan validation before command spawn, enters one cleanup
scope and safely releases that exact still-current authority unless authority itself was lost. Direct operator
exit is observed independently of inherited broker-pipe closure. If that exit races any queued, partial, or
in-flight broker request, the wrapper closes admission, aborts pending HTTP, reaps the whole command group,
reports an indeterminate nonzero result, and does not release the capability lease.

A `202 draining` response is ownership of the closed admission epoch, NOT permission to execute. The wrapper
creates no command process and no broker FD while draining; it may only heartbeat that exact epoch and poll
sanitized status. Only observing `active` at the same epoch permits it to create the broker and execute the
command exactly once. Expiry, owner loss, an epoch change, status failure, heartbeat failure, or a transition
back to `open` fails the wrapper without executing the command. Its best-effort cleanup cannot revive or release
a stale epoch. The acquire request body is the canonical immutable capability list resolved from the wrapper's
flags; duplicates, wrong selectors, and any server response whose capabilities differ fail before execution.

Nested `spex` clients receive only three inherited anonymous broker file descriptors (request/response/turn)
plus their non-secret FD numbers. The turn FD carries one non-secret byte token: a client takes it, writes one
`<= PIPE_BUF` request frame containing its request id and exact PID/start identity, reads only its matching
response, then returns the token. The parent relays the token and serializes exact capability requests on that bounded channel,
checks operation, session id, and resume force against its copied plan, and is the only process that adds the
dedicated HTTP header. A wrong session, wrong operation, wrong force, duplicate/replayed capability, or request
after EOF/epoch completion is rejected locally and never reaches HTTP. No child or
grandchild receives the bearer through argv, stdout/stderr, environment, file, or socket path. EOF closes the
broker; after wrapper release its FDs authorize nothing. This inherited-FD mechanism is part of the future
implementation acceptance bar: if the supported Node/Unix launch path cannot preserve it exactly through the
operator command, implementation stops rather than weakening secrecy. Auth/project failure precedes lease
lookup. There is no private-import-only lifecycle and no force-break verb.

This node owns session admission only. It is not auth, an archive/status, a process signal API, a shared-root
replacement mechanism, or a Git/filesystem freeze. It does not stop native Codex clients that connect directly
to the Unix socket and bypass SpexCode. A legacy-root runbook must separately close that native socket's
admission, perform the peer and terminal-turn census, and prove exact old PID/start/socket ownership before it
signals anything.
