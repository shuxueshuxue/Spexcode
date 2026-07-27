---
title: session maintenance lease
status: active
hue: 280
desc: A project-scoped admission barrier that drains in-flight session writes, blocks ordinary mutation, and admits only a finite exact stop/resume maintenance plan.
related:
  - spec-cli/src/session-maintenance.test.ts
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
`open -> draining -> active -> open`. Every Spex-owned session operation that can write state or address a
runtime first acquires an **operation ticket before any side effect**: session creation and its no-backend
fallback, lifecycle transitions, hook-authored state, prompt dispatch/send, raw terminal input, interrupt,
rename, stop/resume/archive/close, merge dispatch, queue draining, and shared-runtime spawn. Reads remain open.
The future implementation belongs in one module, `spec-cli/src/session-maintenance.ts`; this spec becomes that
file's sole `code:` governor in the implementation checkpoint, when the path exists. Until then its red contract
suite is related here rather than legitimizing a product stub.

Acquiring a lease atomically changes `open` to `draining`, thereby closing ordinary admission, then waits for
every ticket admitted under the preceding epoch to finish. A ticket cannot appear between that close and the
drain census. Once the old ticket set is empty the same compare-and-swap advances to `active`. Any other write
fails before its callback, transport, signal, record write, queue claim, or spawn with the structured code
`maintenance_active`; callers preserve that code across HTTP/CLI instead of collapsing it into not-found or a
generic transport failure. Releasing the exact active epoch returns to `open`.

An active lease admits only the finite capabilities fixed at acquisition. A capability is exactly
`{op:"stop", sessionId}` or `{op:"resume", sessionId, force}`; session id and resume force must match. This is
enough to quiesce several protected leaves and resume those same leaves before ordinary admission reopens.
Capabilities cannot be added, widened, or transferred after acquisition. The shared-runtime spawn nested
inside an admitted resume rides that resume's live ticket; it is not a separately grantable capability and a
direct spawn during maintenance is refused. Thus the canonical launcher remains the one shared-root creator
without opening unrelated launch or queue work.

The bearer is an opaque 256-bit random token returned once. Only its cryptographic hash is persisted. HTTP
carries it in one dedicated header; it never appears in a URL/query, argv, session record, timeline, comms
edge, ordinary log, or error. The header is maintenance admission, **not authentication**: normal endpoint
authentication and project binding run first and remain mandatory. A correct token cannot make an untrusted
request trusted.

The durable record carries a monotonically increasing epoch, token hash, exact immutable capability list,
lease owner PID plus process-start identity, heartbeat deadline, and state. Heartbeat and release are epoch CAS
operations: a delayed owner from an earlier generation cannot extend or release a replacement. Backend restart
re-reads and honors `draining`/`active` before accepting a write. Tickets likewise persist owner PID/start,
epoch, operation, optional target identity, and deadline. Recovery removes a ticket only when the exact owner is
dead/reused or its bounded deadline elapsed; an ambiguous/live ticket stays a blocker. A lease expires only by
its heartbeat/TTL rule or exact epoch release. There is no force-break of a live lease.

This node owns session admission only. It is not auth, an archive/status, a process signal API, a shared-root
replacement mechanism, or a Git/filesystem freeze. It does not stop native Codex clients that connect directly
to the Unix socket and bypass SpexCode. A legacy-root runbook must separately close that native socket's
admission, perform the peer and terminal-turn census, and prove exact old PID/start/socket ownership before it
signals anything.
