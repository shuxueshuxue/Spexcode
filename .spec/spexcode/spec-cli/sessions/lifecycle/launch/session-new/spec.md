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
  - spec-cli/src/git.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/session-create-transaction.test.ts
  - spec-cli/src/sessions.test.ts
  - spec-dashboard/src/launch.test.mjs
---

# session-new

## raw source

The public `POST /api/sessions` call is the ownership boundary for creating a governed session. It must never
leave a caller waiting behind invisible preparation with no session to inspect, and it must never keep creating
after that caller has received a failure. One request therefore has exactly two terminal outcomes: one durable,
recoverable session receipt, or one structured failure after all session-specific work is gone.

## expanded spec

Creation is a bounded transaction whose commit point is the atomic `session.json` publication. Before that
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

The public request accepts the standard `Idempotency-Key` header. The backend deterministically maps a valid
key to one candidate session id and binds it to the normalized `{prompt,parent,launcher}` payload. Creation for
that id is serialized at the existing per-session lock. A same-key retry, including a concurrent retry or a
retry after the response connection was lost, either joins the in-flight transaction and receives its one
published receipt, or starts after a fully rolled-back failure. Reusing the key with another payload fails
with `session_create_key_reused` and creates nothing. Callers that omit the header receive ordinary one-shot
semantics with a backend-minted key; SpexCode's own CLI always sends a fresh key and retains it across its one
bounded request attempt.

Before that attempt the CLI may enter the existing in-process fallback only after an explicit
`ECONNREFUSED` proves the selected target has no listener. Every HTTP response, including `404` and `503`,
proves that a backend owns the target; a slow accepted connection, abort, reset, DNS failure, or unknown
transport outcome is indeterminate. Those cases fail loud without local creation, because the remote owner
may already have admitted the keyed request.

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
