---
title: spawner-pointer
status: active
hue: 280
desc: A child session is told where its spawner works — one line naming that session's worktree and branch — because the child's own worktree is branched off the base, so the spawner's in-flight work is absent from it and invisible to the spec pointer.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/sessions.test.ts
---

# spawner-pointer

## raw source

A session launched from inside another session gets a worktree branched off the **base branch**, never off
its spawner. So everything that session has in flight — a spec node it just created, an edit it has not
landed — is absent from the child's tree. It is also invisible to [[spec-pointer]], which resolves the
prompt's `[[id]]` against the spec index of the **backend's own checkout**: a node living only on the
spawner's branch simply is not there, and [[spec-pointer]]'s fail-quiet rule means nothing says so. The
child is then blind to the very context it was created to continue, and blind silently.

The fix is not to teach the fork or the landing about nesting. Both would have to learn a **second base** —
what this branch forked from, distinct from what it merges into — which splits every base question in the
system (the overlay's own-work diff, the ahead gate, session-eval's fork point, the review diff, the merge
target) into two, and the landing would still carry the spawner's unreviewed commits into whatever the
child merges into, because git merge carries ancestry. Tell the child **where its spawner works** instead,
and let it decide whether to look. Provenance the agent can act on, not only a dashboard fold.

## expanded spec

When `newSession` has a `parent` ([[session-nesting]]), it appends **one line** to the launch prompt: the
spawner's short session id, its label when it has one, its **worktree path**, and its **branch** — followed
by the reason the child needs it, stated plainly: the child's own worktree is branched from the base and
therefore does not contain that session's uncommitted or unmerged work. The child reads across when its task
needs to.

The instruction is **read-only**. Another session's worktree is a live tree with an owner mid-edit; writing
into it races that owner and lands changes no branch of the writer's will ever carry.

Same family rule as the other injections: a **POINTER, never a body** — the launch prompt stays small and the
agent always reads the live file. And **fail-quiet by absence**, the rule [[spec-pointer]] already follows: no
parent (a human launching from a plain shell), or a parent whose record carries no worktree, appends nothing.

It **composes with** [[spec-pointer]] rather than replacing it. A dispatch naming a node that exists in the
base tree still gets its own spec path first; a dispatch whose node lives only on the spawner's branch gets
the spawner line alone — not the path it wanted, but enough for the agent to find it. The clause is a pure
function of the spawner's record, so what the child is told is exactly what the board shows about its parent.
