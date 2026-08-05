---
scenarios:
  - name: committed-plus-local-overlay
    description: >
      Through real CLI verbs (never by reading layout.ts), initialize a throwaway repo whose root checkout is
      on `staging`; `spex init` must stamp that branch. Then use ordinary `git switch` to check out `node/x`
      in the same directory and also create a linked worktree. Read `spex internal trunk` from both; add a
      gitignored spexcode.local.json override, then make one config file malformed and re-run.
    expected: >
      Both checkout methods keep naming `staging`; the ordinary switch never redefines `node/x` as trunk.
      Resolution follows local overlay > committed spexcode.json > conventional `main`. A present malformed
      file fails LOUD naming the file and parse error; it never silently drops the stable branch fact.
    tags: [cli]
    code:
      - spec-cli/src/layout.ts#mainBranch
      - spec-cli/src/layout.ts#readConfig
  - name: cold-overlay-width-does-not-multiply-by-public-surface
    description: >
      In an isolated real repository, create several governed linked worktrees spanning clean edits, a rename,
      dirty and untracked state, and an archived row. Start the real backend, then concurrently request public
      `/api/settings` and `/api/graph` through a Git argv recorder.
    expected: >
      Both public surfaces return the same complete session rows and exact ops. The cold generation performs
      one framed clean-tree batch and one merge-base/status proof per active worktree rather than repeating the
      worktree fanout per surface; dirty, untracked, rename, main-advance, archived, and degraded semantics are
      unchanged. A failed flight is not cached and the next request can repair.
    tags: [backend-api]
    code:
      - spec-cli/src/layout.ts#resolveLayout
      - spec-cli/src/layout.ts#layoutDeltas
      - spec-cli/src/git.ts#worktreeSpecDeltas
    test: spec-cli/src/layout-overlay.api.test.ts
  - name: record-less-store-dir-never-scans-the-store
    description: >
      In an isolated SPEXCODE_HOME, build a store holding both records and record-less session directories
      (the sentinel-only self-launched shape), including one record-less directory whose name equals another
      record's `harness_session_id`. Resolve those ids through the alias seam, with the sessions root left
      traversable but not enumerable so that any store scan is observable as a fail-loud readdir error.
    expected: >
      A record-less store directory resolves as absent without enumerating the store, so the neighbouring
      record never answers under that live session's name and the per-tick cost stays one directory check
      rather than a whole-store re-read. Genuine alias resolution — an id owning no store directory — still
      finds the one record that captured it as `harness_session_id`.
    tags: [cli]
    code:
      - spec-cli/src/layout.ts#readAliasedRecordEntry
    test: spec-cli/src/layout-session-id.test.ts
---

Measured through the CLI seam that resolves layout for every other verb (`spex internal trunk` =
layout.ts mainBranch()), in a throwaway repo with an isolated SPEXCODE_HOME. The reading is the verb's
stdout/exit per config state; file the transcript with `--result`.
