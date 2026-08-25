---
title: session-create-authority
status: active
hue: 280
desc: What a public create must establish before it may use the local path — one identity probe with its own budget and its single ECONNREFUSED licence — plus the fork point it may pin and the fork commit it always records.
code:
  - spec-cli/src/sessions.ts#sessionCreateRequest
related:
  - spec-cli/src/session-create-cli.test.ts
  - spec-cli/src/client.ts
  - packages/spec-core/src/layout.ts
---

# session-create-authority

A create is the one session verb that can be asked of the wrong backend, and the one that decides which commit
the work starts from. Both are settled BEFORE any Git mutation, so a refusal leaves no half-made worktree,
branch, store, or receipt behind.

**Public session creation asks one lightweight authority question before it may use the local path.** The CLI
asks only `GET /api/instance` — an identity route that enumerates no governed records and derives no worktree
overlays — against its own 1500ms budget; an optional recorded-endpoint health read is discovery only and never
consumes it. An explicit target skips project comparison and normally owns the one keyed `POST /api/sessions`; an
implicit target does so once the instance identity canonically matches, compared through the shared main-root
resolver (which follows a linked worktree to its common checkout and applies the configured `main`) rather than
by raw path. Any HTTP response proves ownership, and a proven mismatch is still refused. The SOLE licence for the
in-process fallback is an exact no-listener failure whose entire transport cause chain is `ECONNREFUSED`;
timeout, reset, DNS, and every other transport result fail without local creation, and a response already
received is never relabelled indeterminate.

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
