---
title: close
status: active
hue: 280
desc: Close preserves a session's record, branch, transcript, and dirty work in a durable archive ref after an exact cold stop.
related:
  - spec-cli/src/sessions.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/graph.ts
  - spec-cli/src/session-close-active.api.test.ts
  - spec-cli/src/session-close-live-boundary.api.test.ts
  - spec-cli/src/session-close-probe.test.ts
  - spec-cli/test/session-close-dirty.e2e.mjs
  - spec-cli/test/session-close-ref-failure.e2e.mjs
  - spec-cli/test/session-close-legacy.e2e.mjs
---

# close

## raw source

There is one reversible lifecycle transition for a session that is no longer on the working board: `close`.
It proves the same exact cold stop as `stop`, then records the complete worktree state in
`refs/spex-archive/<session-id>`, removes only the worktree, and retains the local branch, session record,
timeline, transcript, and native conversation identity. `resume` recreates the worktree from the retained
branch and reapplies the archive-ref difference as ordinary uncommitted files before relaunching the runtime.
No product surface offers a permanent-delete verb.

## expanded spec

**Close is a soft cold transition.** A close is admitted only after exact leaf ownership, tmux/session transport
absence, adapter cleanup, generation and descendant fences, and all failure compensation from the former cold-stop
path succeed. A native turn in flight is a loud refusal; close does not interrupt it. The refused close leaves the
record, worktree, branch, and runtime unchanged. A queued row proves its prepared runtime absence under the same
transition lock and is eligible without a running turn.
An unbound launch residue is eligible for close once its bounded readiness window has expired or its exact
host process/transport is proven absent. The close guard must not treat a stale launch artifact as perpetual
"launch or recovery is still in progress"; only a currently progressing, live or unproven owner may refuse.
For a shared Codex session whose exact generation is already positively retired, generation absence is the cold
proof: the adapter reports an empty control plane, drops the stale binding, and close continues through its own
archive/worktree removal. Only a live or genuinely ambiguous generation can refuse on the generation/census seam.

After cold proof, close writes the worktree tree (tracked and untracked files) as a commit whose parent is the
current branch tip, then atomically publishes `refs/spex-archive/<session-id>` and verifies that ref. A ref or
commit failure aborts before any directory mutation. Only after publication does it rename the worktree on the
same volume from `.worktrees/<name>` to `.worktrees/.trash/wt-<epoch>-<nonce>`, run `git worktree prune` to
invalidate Git's old registration, and enqueue the renamed tree for serial asynchronous deletion. The close
request never recursively removes the worktree; a backend-start scan resumes `.trash/` leftovers, and every
deletion failure is logged and left for the next startup retry. The materialize slot is removed after enqueueing.
The branch and the global session store remain. The record is retained with `archived: true`,
`stopped: true`, a cold proof, and the same close transaction's ISO `closedAt`; list projection omits it from the
working board while id-addressed record, timeline, transcript, and conversation reads remain available. A record
with a non-null `closedAt` is projected with `archived: true` in every public projection, regardless of the lifecycle
or proposal it carried before close; its liveness remains the runtime reading (`offline` after the cold proof), and
its display status is not rewritten to `retired`. The canonical lifecycle settles to the internal terminal marker
`archived` and the proposal is cleared at close. Public session projection exposes that timestamp for a cheap complete
archive index. Records closed before this field
existed project `closedAt: null`; consumers identify their time as unknown rather than borrowing creation time,
manual sort order, timeline reads, or filesystem metadata.

**Resume is the inverse.** For a closed row whose worktree is absent, resume creates the recorded branch at the
recorded path. If the archive ref exists, its diff against the branch tip is applied to the new worktree so all
tracked edits, deletions, and untracked files return as uncommitted state. A legacy `archived: true` row without
an archive ref is still readable and resumable from its retained branch; it simply has no extra dirty delta to
restore. Only then does the normal adapter launch/readiness fence run. Any restore or launch failure keeps the
record archived and the worktree available for a bounded retry.

**Compatibility.** Existing records with `archived: true`, `coldProof`, or `archiveHazard` remain valid input.
They project as closed/offline when their target is not live, regardless of whether the old cold proof is present;
the old hazard fields are read but never required for transcript or conversation reads. Resume accepts these rows,
materializes their retained branch, and follows the same launch path. The removed archive and unarchive spellings,
the close-history route/ledger, cold-retirement-only deletion path, queued/identity-less deletion shortcuts, and
native close interrupt are not part of the current protocol.

The board is a projection, not a second store: closed rows are hidden from the working projection but remain in the
session record enumeration used by `--all` and id-addressed reads. Their branch is deliberately not deleted, so a
human can inspect or merge it explicitly while the product supplies no permanent cleanup action. Canonical state
projection may create a fresh in-memory record for an ordinary live row; that is not an archive hazard. The hazard
marker is reserved for an input record marked `archived` whose cold proof or physical unload is not established.
