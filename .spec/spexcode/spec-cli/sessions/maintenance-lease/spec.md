---
title: session maintenance lease
status: active
hue: 280
desc: A project-scoped admission barrier that drains in-flight session writes, blocks ordinary mutation, and admits only a finite exact stop/resume maintenance plan.
code:
  - spec-cli/test/session-maintenance-http-fixture.mjs
related:
  - spec-cli/test/session-maintenance-cas-fixture.ts
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
match exactly. A capability is one-shot: its atomic claim creates at most one live ticket. A successful callback
marks it completed; a repeated or concurrent request returns `maintenance_capability_used` without running the
callback. A refusal before callback leaves it unused and may be retried. A callback throw marks it
`indeterminate`; retry is refused because a side effect may already have happened. Release is still explicit,
but never implies that unused/indeterminate work succeeded.

Canonical shared spawn is not grantable directly. An admitted resume mints a separate opaque, one-use delegated
capability bound to that live resume ticket, epoch, operation, and session id. The nested internal
`shared-runtime-spawn` consumes it while the parent resume ticket is still live, scrubs it before exec, and never
places it in argv, logs, records, events, or comms. Forged, stale-epoch, completed-parent, wrong-session,
wrong-operation, and replayed delegates all fail before spawn. Thus the canonical spawn rides exactly one
admitted resume without opening unrelated launch or queue work.

### Bearer, durability, and public lifecycle

The lease bearer is 32 cryptographically random bytes encoded opaquely and returned once. The durable row stores
exactly `SHA-256(token)`; verification hashes the presented token and uses a length-normalized constant-time
digest comparison. Neither the raw lease token nor a delegated bearer appears in tickets, events, errors,
URLs/query, argv, session records, timelines, comms, or ordinary logs. HTTP carries the lease token only in
`X-SpexCode-Session-Maintenance`. Normal endpoint authentication and project binding run first and remain
mandatory: maintenance admission is not authentication.

The durable row atomically stores version, state, monotonically increasing epoch, token hash, an immutable
canonical capability copy plus each capability's claim state, exact owner PID/start, heartbeat deadline, and
tickets containing only id, epoch, closed operation, optional target/force, exact owner PID/start, and reporting
deadline. Release clears the lease material but preserves the epoch; every later acquire increments it. Backend
restart reads and honors `draining`/`active` before serving any write. Heartbeat and release require the exact
current epoch and token; missing token, wrong token, stale token/epoch, malformed TTL, and wrong project all
fail without changing durable state or events.

The public porcelain stays under the existing session noun: `spex session maintain --allow-stop <SEL> ...
--allow-resume <SEL>[:force] ... -- <command...>` is one scoped wrapper, and `spex session maintain --status`
is its sanitized read. There is no seventh CLI noun and no separately typeable acquire/heartbeat/release
sequence that would make shell history the bearer store. The wrapper's authenticated HTTP lifecycle is
`POST /api/session-maintenance/acquire`, `GET /api/session-maintenance`, and POST `heartbeat`/`release` children.
Acquire accepts the finite capabilities, `ttlMs` in `[5000,300000]`, and `waitMs` in `[0,120000]` with
`waitMs <= ttlMs`; it returns `201 active` or, when the bounded wait ends while tickets remain, `202 draining`,
with epoch and the token exactly once to the wrapper's in-memory HTTP client. Status exposes
state/epoch/deadlines/capability states and sanitized ticket owners, never bearer material. Heartbeat accepts
the same finite TTL range. The wrapper keeps the bearer in memory, heartbeats while its command runs, and
releases in `finally`; it never prints or exports the bearer.

A `202 draining` response is ownership of the closed admission epoch, NOT permission to execute. The wrapper
creates no command process and no broker FD while draining; it may only heartbeat that exact epoch and poll
sanitized status. Only observing `active` at the same epoch permits it to create the broker and execute the
command exactly once. Expiry, owner loss, an epoch change, status failure, heartbeat failure, or a transition
back to `open` fails the wrapper without executing the command. Its best-effort cleanup cannot revive or release
a stale epoch. The acquire request body is the canonical immutable capability list resolved from the wrapper's
flags; duplicates, wrong selectors, and any server response whose capabilities differ fail before execution.

Nested `spex` clients receive only two inherited anonymous broker file descriptors (request/response) plus
their non-secret FD numbers. The parent wrapper serializes exact capability requests on that bounded channel,
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
