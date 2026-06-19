---
title: source-of-truth
status: merged
session: sess-ce4e5cc
hue: 200
desc: .spec on main is canonical; worktrees hold session-attributed proposals.
code:
  - spec-cli/src/specs.ts
  - spec-cli/src/git.ts
  - spec-cli/src/index.ts
---
# source-of-truth

The canonical spec state is `.spec` on `main`. A worktree's `.spec` is never a
rival truth — it is a pending proposal, attributed to a session. On merge it
becomes the new version plus one entry in that node's history. The dashboard is a
read-time aggregator over git, not a separate store.

Because git *is* the database, reading it must scale with history, not with how
many nodes ask. The aggregator therefore walks the whole `.spec` timeline in a
**single `git log` pass** (`historyIndex` in `git.ts`), bucketing every commit's
rows by each file's current path and following reparent renames backward
in-memory — so a node that moved still reads as one continuous history, and a
pure move never counts as a version. The result is cached on `HEAD`: committed
history is immutable, so a warm read is one `rev-parse`. This replaces the old
per-node `git log --follow` (two child processes per node, each re-walking all of
history — `O(nodes × commits)`); `loadSpecs` now does one walk regardless of node
count. Arbitrary non-`.spec` files (the governed *code* paths `spex lint` checks)
keep the per-file `--follow` path, since the bulk index only covers `.spec`.

Because the aggregator reads git, a node's *whole* observable state is derived here, not stored:
`version` (content-commit count), `drift` (governed code ahead of the latest version), and now its
**`status`** — a four-state value (`deriveStatus`) computed from version + drift, with frontmatter
kept only as a fallback. `loadSpecs` derives the git-only part (pending/drift/merged); the live
`active` state, which needs the worktree overlay, is layered on by the board assembler. The
four-state model is specified in [[spec-node-states]].
