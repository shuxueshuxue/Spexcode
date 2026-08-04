---
title: session-reparent
status: active
hue: 300
desc: Move governed child sessions to a new supervisor as one lock-protected parent-and-watch rewrite, without depending on the former parent being alive.
code:
  - spec-cli/src/session-reparent.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-follow.ts
  - spec-cli/src/client.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/session-reparent.test.ts
---

# session-reparent

## raw source

A supervisor can disappear while its workers remain useful. Moving those workers to the replacement
supervisor must be one supported operation, not a sequence of raw JSON edits that leaves the tree and
delivery relations disagreeing.

## expanded spec

`spex session reparent <child-SEL...> --to <parent-SEL>` moves one or more governed sessions in the
same project store to another governed supervisor. It resolves every selector before changing anything,
rejects a child that is its own parent or would make a parent cycle, and names an absent, ambiguous, or
ungoverned session loudly. One child can be active or in a harness turn: reparent changes neither its
process nor authored lifecycle, and its next record transition simply observes the new watcher set.

For each child, the operation holds that child's ordinary record lock while it replaces the durable
`parent` pointer and its target-owned `watchers.json` relation: the former parent is removed and the new
parent is present exactly once. The old record is never asked to run a cancellation, so an offline or dead
former supervisor is ordinary input. Existing messages already accepted into that former supervisor's
queue remain history and debt; removal prevents only future watch notices. After the rewrite commits, the
new parent is sent the child's current authored state through normal dispatch, matching an ordinary
`session watch` installation.

The command validates the complete batch before changing the first child and reports the committed child
ids. A filesystem failure rolls back the in-memory watch rewrite for that child before releasing its lock;
there is no second index or daemon reconciliation. Reads rebuild the tree from each child record, so the
next `session ls` or graph request immediately shows the new parentage. Repeating the same move is
idempotent: it preserves one new-parent watch and repairs a lingering old-parent watch.

It is an owner-style manager write: a reachable backend performs it through its API; a local invocation
may take the same locks only after proving no backend is listening, while an explicit remote `--api` is
transport-only and fails loudly when unreachable. The operation has no SSH, process, or terminal premise.
