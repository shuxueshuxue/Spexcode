---
title: session-new
status: active
hue: 280
desc: Public session creation is one bounded idempotent transaction: publish one recoverable queued receipt or remove every session artifact and return a structured failure.
code:
  - spec-dashboard/src/launch.js
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/client.ts
  - packages/spec-core/src/git.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-create-transaction.test.ts
  - spec-cli/src/sessions.test.ts
  - spec-dashboard/src/launch.test.mjs
  - spec-dashboard/test/session-create-name.e2e.mjs
---

# session-new

## raw source

The public `POST /api/sessions` call is the ownership boundary for creating a governed session. It must never
leave a caller waiting behind invisible preparation with no session to inspect, and it must never keep creating
after that caller has received a failure. One request therefore has exactly two terminal outcomes: one durable,
recoverable session receipt, or one structured failure after all session-specific work is gone.

## expanded spec

Creation is a bounded transaction whose commit point is the atomic `runtime.json` publication. Before that
point, launcher resolution and prompt composition are read-only; Git may create exactly the candidate branch
and worktree; and the global store may contain only the candidate's private preparation files. A deadline,
client disconnect, cancellation, or phase failure before publication aborts active Git work, opens no launcher
pane, removes the candidate store directory, worktree, and branch, releases its creation lock, and returns a
structured non-2xx JSON body:

```
{ "error": "...", "code": "session_create_timeout|session_create_cancelled|session_create_failed", "phase": "..." }
```

Cleanup is part of the outcome, not a detached best-effort continuation. If exact cleanup cannot be proved,
the request returns `session_create_cleanup_failed` and names the residue rather than claiming zero artifacts.
No timeout path falls back to another launcher, an in-process create, or a background create.

Branch and worktree names are shorter than the session identity, so a different request may derive the same
Git resources. The transaction therefore locks the exact `{branch,path}` pair with the existing lock primitive,
then records whether the store, branch, and registered worktree were absent before preparation and which of
them its successful operations created. Pre-existing resources fail without mutation. Rollback consumes that
one ownership receipt and removes only resources this transaction proved it created; a failed add never turns
the candidate name into authority to delete. A colliding request therefore cannot damage an already-published
receipt, while a transaction that owns its candidate still removes exactly that candidate on abort.

Process-local ownership is not enough: the backend may die after creating Git or store resources but before
publishing the record. Before the first Git mutation, while holding both the candidate id lock and exact
`{branch,path}` lock, creation atomically publishes one private candidate receipt outside the session store.
It binds the request digest and payload hash to the exact root, path, branch, all-absent resource pre-state,
and the last durably reached preparation stage. A restart holding those same locks may inspect, clean, and
restart the candidate only when that receipt is valid and matches every field of the retry. A different key,
mismatched payload/resource identity, malformed receipt, or occupied orphan with no receipt conveys no
ownership: all resources are preserved and creation fails loud. Normal rollback or record publication retires
the private receipt; a matching retry also retires a publication-left receipt after recovering the public row.

Record publication itself fences any receipt that could not be retired: while that public record exists,
create returns it and never enters candidate cleanup. Before terminal close may remove that fence, close holds
the same session-id and exact `{branch,path}` resource locks, retires a valid matching candidate receipt, and
proves it absent. If retirement cannot be proved, close fails before stopping or deleting the session and
preserves its record, store, worktree, and branch. An irreversible record publication is never reported as a
rollback, and a stale receipt can never outlive close with authority to consume a later colliding session.

The public request accepts the standard `Idempotency-Key` header. The backend deterministically maps a valid
key to one candidate session id and binds it to the normalized `{prompt,parent,launcher,name?}` payload. Creation for
that id is serialized at the existing per-session lock. A same-key retry, including a concurrent retry or a
retry after the response connection was lost, either joins the in-flight transaction and receives its one
published receipt, or starts after a fully rolled-back failure. Reusing the key with another payload fails
with `session_create_key_reused` and creates nothing. Callers that omit the header receive ordinary one-shot
semantics with a backend-minted key; SpexCode's own CLI always sends a fresh key and retains it across its one
bounded request attempt.

Before that attempt the CLI opens a bounded TCP connection, which is the presence probe, then performs one
`GET /api/instance` identity read. The route is small and never `/api/settings`: creation authority must not
enumerate session records or derive layout overlays. The TCP presence budget ends when a connection is accepted;
the identity read then uses the ordinary create request deadline, so a busy event loop cannot look absent merely
because response headers are late.

The dashboard may project the backend launcher registry into a dashboard-visible subset for adapters reserved for
external integrations. That presentation filter does not change this creation transaction: an explicit CLI/API
launcher remains resolved and validated by the backend under the normal launcher contract.
For an implicit target, each supplied root is resolved through the shared lightweight main-root resolver before
comparison, so a linked worktree and an explicit configured `main` retain their canonical project identity;
`--api` names the target and skips that comparison but still makes this availability decision: normally that
explicit target owns the one POST. The only exception is an exact all-chain `ECONNREFUSED` before acceptance,
which proves that the selected target has no listener and permits the existing in-process fallback. The optional
recorded-endpoint health read is only target discovery and has its own wall; it does not consume the presence
budget. Every HTTP response, including `404` and `503`, proves that a backend owns the target; a reset, DNS
failure, or unknown transport outcome after acceptance is a backend error and never falls back. A failure before
acceptance is indeterminate and fails loud without local creation.

`sessionCreateRequest` is the only callable governed-session creation seam. It owns validation, maintenance
admission, request identity, deadline/cancellation, and the private prepare/publish function's required context.
The HTTP route, CLI no-listener fallback, and New Session composer call it. Preparation is not exported and
cannot mint a never-aborted context for itself, so adding another caller cannot bypass the wall or transaction owner.

`--name` is the CLI's optional human creation input for the existing record display override, not prompt content
and not another identity. The CLI carries it through the HTTP payload, where it follows `rename`'s normalization
(trimmed; blank means absent) and writes the new record's one `name` field at publication. Dashboard New Session
does not author or send a name; it continues to create from its prompt/launcher form and only renders the resulting
derived title. The branch/worktree slug and prompt-derived stored title remain unchanged. Consequently
[[session-label]] derives the first public title and compatible label from the same field that a later rename
replaces or clears.

The record publication is the irreversible boundary. The transaction checks cancellation immediately before
the synchronous atomic record replace and re-proves that the candidate path is the exact Git top-level, is
checked out on the recorded branch, and that exact branch ref exists. JavaScript cannot interleave an abort
between the final check and replace. A `201` may therefore never name a detached, switched, deleted, or
rolled-back Git candidate.
Once the record exists, a lost connection is a lost response, not a failed create: the same idempotency key
recovers the receipt. The published record is already a normal durable `queued` session with its prompt and
launch payload present, so backend restart and the ordinary queue supervisor can recover it. Queue draining is
requested only after publication and is not awaited by the HTTP receipt; a slow, stopped, or broken launcher
therefore cannot hold session creation open. This is the existing queue mechanism, not a second create worker.
When the record has a governed parent, publication also installs that parent source before requesting the drain,
but defers its initial snapshot behind the same queue decision. Capacity-confirmed backlog resolves it once as
`queued`; an admitted worker resolves it once as `working` only after launch readiness is revalidated against the
existing active/resource publication. A readiness failure preserves that resource contract and records the
existing loud failure note, while retiring the debt without a fabricated working snapshot. The deferred snapshot
is also retired without delivery when synchronous launch/preflight fails; such a failure must not impersonate the
queue's proven full-capacity decision. A retryable launcher failure retains the same debt for the next queue pass. On
server restart, an active row with debt may reclaim only its readiness observer: it does not launch again or replay the
prompt. Snapshot acceptance is idempotent by debt token and authored state, including an actionable state that races
the initial acceptance, so crash replay neither duplicates accepted messages nor loses the raced transition. The debt
does not turn the later parent-only working suppression into a special transition rule.
The successful HTTP route also nudges the graph's `sessions` projection after publication, so dashboard row
delivery does not depend on the session-store watcher; any candidate worktree registry refresh remains its own
asynchronous full convergence.

Target resolution on this write path reads the live filesystem-only spec projection. It needs only a node id
and `spec.md` path; it must not build history, drift, graph, or eval projections before publication. The
session's raw first `[[id]]` mention remains its only scope source, and prompt preset expansion remains the one
shared launch/dispatch seam.

The existing creation owner reads [[portable-layout]]'s `main` and `branchPrefix` settings through the shared
config seam. The worktree lives under the resolved main checkout's supported `.worktrees` directory and the
branch uses that prefix; creation does not rebuild the full board layout merely to read those settings.

Every transaction emits one-line structured phase diagnostics with an ISO timestamp, a non-secret request-id
digest, candidate session id, phase, and event (`start`, `finish`, `abort`, or `publish`). The required phases
are request, creation-lock, target-resolution, Git worktree, record write, and launcher queue. Diagnostics
contain no prompt, raw idempotency key, auth material, environment, or process dump. They are operational
evidence only; the record and Git tree remain source of truth.
