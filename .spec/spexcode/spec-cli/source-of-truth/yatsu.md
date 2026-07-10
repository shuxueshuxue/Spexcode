---
scenarios:
  - name: derivation-from-git
    tags: [cli]
    code: spec-cli/src/specs.ts
    related: [spec-cli/src/git.ts]
    description: >-
      In an isolated spex-init repo, take one node through three git moves and read `spex board` after
      each: (1) edit its spec.md body and commit with a `Session: <id>` trailer; (2) commit a pure
      rename/reparent of the node's directory (basename unchanged); (3) inspect the repo for any
      persisted derivation state beside `.spec`.
    expected: >-
      Version, reason, and session are DERIVED from git on read, never stored: the content commit bumps
      `version` by exactly one and the board row carries that commit's subject as `reason` and its
      `Session:` trailer as `session`; the pure rename bumps NOTHING (a reparent is not a version); and
      no datastore/hash/index file exists beside the spec tree — delete nothing, recompute everything.
---

# measuring source-of-truth

YATU through the real CLI (`spex board`) against an isolated repo: the loss being watched is any drift
between git history and the board's derived facts — a version that doesn't match the content-commit
count, attribution that doesn't come from the `Session:` trailer, a rename that fabricates a version, or
any state file that would make the dashboard a second store instead of a read-time aggregator over git.
