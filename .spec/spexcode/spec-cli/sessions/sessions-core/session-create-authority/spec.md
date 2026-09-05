---
title: session-create-authority
status: active
hue: 280
desc: What a public create must establish before it may use the local path — one identity probe with its own budget and its single ECONNREFUSED licence — plus the fork point it may pin, the fork commit it always records, and the supervisor its prompt may address.
code:
  - spec-cli/src/sessions.ts#sessionCreateRequest
related:
  - spec-cli/src/session-create-cli.test.ts
  - spec-cli/src/client.ts
  - spec-cli/src/session-selectors.ts
  - spec-cli/src/mentions.ts
  - spec-cli/src/sessions.test.ts
  - packages/spec-core/src/layout.ts
---

# session-create-authority

A create is the one session verb that can be asked of the wrong backend, the one that decides which commit
the work starts from, and the one that decides whose subtree the new work belongs to. All three are settled
BEFORE any Git mutation, so a refusal leaves no half-made worktree, branch, store, or receipt behind.

**Public session creation asks one lightweight authority question before it may use the local path.** The CLI
first opens a bounded TCP connection to the target. A completed connect is the presence fact: the supervisor's
proxy accepts it even while the child event loop is busy, so a slow `/api/instance` response is still a present
backend. Only a connection that is refused (the entire transport cause chain is `ECONNREFUSED`) licenses the
in-process fallback. After presence is established, `GET /api/instance` is the identity read — it enumerates
no governed records and derives no worktree overlays — and it uses the ordinary session-create request deadline,
not the presence budget; an optional recorded-endpoint health read is discovery only and never consumes either
budget. An explicit target skips project comparison and normally owns the one keyed `POST /api/sessions`; an
implicit target does so once the instance identity canonically matches, compared through the shared main-root
resolver (which follows a linked worktree to its common checkout and applies the configured `main`) rather than
by raw path. Any HTTP response proves ownership, and a proven mismatch is still refused. A timeout, reset, DNS,
or other transport failure before TCP acceptance is indeterminate and fails without local creation; a failure
after acceptance is a present-backend authority-read failure and also never falls back.

**Measured finding (out of scope for this lane).** On 2026-08-29 the live backend logged
`/api/graph build took 11822ms (budget 1500ms)`: one event-loop stall is long enough to make a header-deadline
probe report a false absence. The create authority now treats that stall as presence and delegates to the
backend; the graph build's blocking work remains a separate performance investigation.

**A create may pin its fork point.** Creation accepts an optional `base` — any commit-ish the main checkout can
resolve. Absent, the session forks from the auto-detected source-of-truth branch, i.e. from whatever that branch
has drifted to at the moment the worktree is made; that is right for ordinary work but leaves a run against a
frozen commit inexpressible, so an evaluation, a bisect, or a replay could not name the code it actually ran on.
A supplied `base` is resolved during target resolution, BEFORE any Git mutation: one that names no commit fails
the request with a 400 and leaves no half-made worktree, branch, store, or private candidate receipt behind. A
resolved pin becomes the `git worktree add` start point and is stored on the record, so a later reader can tell
a pinned run from an unpinned one. It also joins the idempotency payload hash — a retry that changes the pin is
a different request, not the same one — while an unpinned create keeps its exact legacy record bytes and
receipt hash, so nothing that never pinned gains a field.

**A create records the commit it actually forked from.** Whether or not a pin was supplied, the branch ref right
after `git worktree add` IS the fork point, and the record keeps it. It is written like the optional pin — present
only on records created since it existed, so an older record keeps its exact bytes — and it is the one fact that
later separates a branch which never authored a commit from one whose commits the base has absorbed. Git ancestry
cannot: both heads are ancestors of the base. A reader that lacks the field recovers the same commit from the branch
ref's creation reflog entry, which is where git wrote that start point; the diff document ([[diff-document]]) is the
surface that spends it.

**A create may address its supervisor from the prompt.** The `parent` field records who RAN the create, which
is provenance and nothing more — so before this, a human launching from the dashboard had no way to hang the
new worker under an existing session at all, and an agent could only ever produce its own children. The prompt
therefore carries the grammar's one create-time directive, `@parent:<selector>` ([[mentions]]). It is read off
the raw prompt first: the token is stripped, the selector resolved against the retained board — archived rows
included, because parentage is a durable pointer that outlives its parent's liveness — through the same shared
matcher every session verb uses ([[session-selectors]]), and the resolved id REPLACES any supplied `parent`.
Explicit addressing outranks provenance. The two candidate sources — the caller that ran the create and the
prompt that addressed a supervisor — are ranked in exactly one place, which yields one settled parentage
carrying both the id and which source won; nothing downstream re-asks, and the source never becomes a second
flag riding the transaction. The published record's `parent` is then an ordinary one, so the read-time
forest, the parent watch source, and [[session-reparent]] all treat it exactly like a spawned child's
([[session-nesting]]).

Everything that could make the directive silently wrong is a `400` before the transaction opens: two different
selectors in one prompt, a selector that names no session, an ambiguous prefix. A create that dropped an
unusable directive would land the worker at top level, where nothing distinguishes the miss from an ordinary
unparented launch until a human goes looking at the forest. `.` resolves to nothing here — the backend's own
environment id and working directory are not a stand-in for whichever caller wrote the prompt. The board read
is paid for only when the directive is present. Because the strip happens before the payload is normalized, a
same-key retry of the same raw prompt hashes identically; the resolved parent is part of that payload, so a
retry whose named supervisor has since vanished is a different request and is refused rather than silently
reparented. The launch text tells the child the truth about which of the two it is: created by a spawner, or
attached under a supervisor that did not create it.

**A node branch never tracks the base branch.** Creation passes `--no-track` when forking from any start point,
including a remote-tracking ref, because landing explicitly merges the base and the node has no business upstream.
This keeps concurrent creates from contending on `.git/config` while Git writes branch upstream metadata.
