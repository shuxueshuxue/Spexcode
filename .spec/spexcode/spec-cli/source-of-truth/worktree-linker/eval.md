---
scenarios:
  - name: foreign-base-no-phantom-ops
    description: >
      Reproduce a worktree whose branch has a FOREIGN fork point (a merge-base with main that predates the
      .spec tree — the zcode CR-review shape: the branch is an MR head plus a commit restoring .spec) while
      its working-tree .spec content is IDENTICAL to main's current tip. Serve the project with a real
      backend, open the real dashboard session list, and read the session row's pending-op badge and
      /api/graph's session ops. Then make ONE real spec.md edit in that worktree and re-read.
    expected: >
      The identical-content worktree contributes ZERO overlay ops (no +N badge on its session row) despite
      the whole .spec tree differing from the fork point; after the single real edit, exactly ONE op for
      that node (type derived against main: `edited` for a node main already has, never `added`) appears.
      A worktree merely BEHIND an advanced main likewise stays at zero — both phantom classes dead, real
      proposals intact.
    tags: [backend-api]
    code: spec-cli/src/git.ts
    related: [spec-cli/src/layout.ts, spec-cli/src/git.test.ts]
---

Measure through the real product surface: a scratch adopter project served by `spex serve`, a governed
session created through the real session API (a stub launcher command is fine — the record and worktree are
what the overlay reads), the branch rewritten to the foreign-base shape with plain git, and the verdict read
off the REAL dashboard session list (the `+N` ops badge) plus `/api/graph`'s `sessions[].ops` — never off a
unit harness alone. The unit tests in `git.test.ts` cover the same four cases as fast regression edges.
