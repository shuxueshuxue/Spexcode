---
scenarios:
  - name: existence-is-definitive-never-drops-a-live-worktree
    tags: [backend-api]
    description: >-
      Exercise the board's per-worktree resilience guard the way the layout overlay uses it. Drive
      `guardWorktree(dir, read, degraded)` — resilience.ts's whole surface — with a detail read that THROWS (the
      git index/ref-lock race under a concurrent merge), for two dirs: one still PRESENT on disk, one already
      GONE. Then install the last-resort process net and raise an uncaught async rejection. Alongside, confirm
      the LIVE backend's board (`GET /api/settings` → layout.worktrees, `GET /health`) still lists every
      existing worktree and stays up. (The race isn't deterministically reproducible over HTTP — `gitA` swallows
      a plain git error to '' — so the guard's two branches are driven directly; the live board proves the
      whole-system consequence.)
    expected: |
      A read failure is NOT non-existence: a THROW with the directory still present serves a DEGRADED row from
      raw facts (the worktree is KEPT on the board, never dropped) and logs `detail-read failed … serving
      degraded row`; a THROW with the directory gone OMITS the row (genuinely removed) and logs `gone from disk
      … omitting`. A read that does not throw returns the normal row. After installProcessGuards, an
      unhandledRejection is LOGGED and the process KEEPS RUNNING (the public port is never dropped) instead of
      Node's default print-stack-and-exit. The live backend lists every existing worktree and answers /health
      throughout — a live session never disappears from the board for a poll, and a transient fault never kills
      the server.
    code: spec-cli/src/resilience.ts
    related: [spec-cli/src/layout.ts, spec-cli/src/git.ts]
---
# eval.md — worktree-resilience

The loss watched is board wholeness under transient faults: a worktree's existence must be definitive (decided
by whether its DIRECTORY is on disk), never hostage to a flaky detail read, and a single failed read must never
crash the server or drop a live worktree. Measured by driving the sole export `guardWorktree` across its two
existence branches (throw+present → degraded/kept, throw+gone → omit) plus the process-level net, and by
confirming through the REAL backend (`/api/settings`, `/health`) that the board lists every existing worktree
and rides out an uncaught throw. Evidence: the driver + live-board transcript (`--result`).
