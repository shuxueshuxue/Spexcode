---
scenarios:
  - name: persistent-event-ledger-release
    tags: [cli]
    code: spec-cli/src/git.ts
    description: >-
      On the pinned fixed-tree history corpus from the source-of-truth cache audit, run the production
      `spex spec lint` CLI in separate processes and implementation-owned HOME directories for a cold seed,
      an exact same-tip hit, and monotonically advancing tips. Compare the candidate against the independent
      full-history implementation at every pinned tip, capturing stdout and stderr on every exit status, and
      first run the known anchor-debt positive control. Record wall time, user+system CPU, peak RSS, ledger
      bytes/rows, and temporary ledger read/decode/write diagnostics; keep the current tree and node population
      fixed while history depth changes.
    expected: >-
      The positive control exposes the known anchor-drift finding, and candidate/full-history normalized
      findings are identical at every tip, preserving history, drift, acknowledgement, anchor, eval freshness,
      and session-impact inputs. One lint opens, verifies, and decodes at most one build-local ledger snapshot,
      performs at most one locked atomic replacement, and never reloads its own write. Same-tip spawns no event
      history walk and retains a material wall/CPU win; advancing-tip event walks are bounded to newly reachable
      history and retain a wall/CPU win. Cold and advancing peak RSS lose the prior material regression, while
      cold seed cost is reported rather than hidden by page-cache or shared-HOME warmth. Corruption rebuilds
      from Git; a failed event walk remains loud and cannot mint a valid tip marker.
  - name: derivation-from-git
    tags: [cli]
    code: spec-cli/src/specs.ts
    related: [spec-cli/src/git.ts]
    description: >-
      In an isolated spex-init repo, take one node through three git moves and read `spex graph --json` after
      each: (1) edit its spec.md body and commit with a `Session: <id>` trailer; (2) commit a pure
      rename/reparent of the node's directory (basename unchanged); (3) on a side branch edit its spec.md,
      revert that edit in a second one-parent commit, and merge the net-TREESAME branch; (4) fork from an old
      node path, edit that old path on the newer-dated main branch while the older-dated side branch renames
      and edits it, then merge; (5) rename one path and later create an unrelated node at the vacated old path;
      (6) inspect the repo for any persisted derivation state beside `.spec`.
    expected: >-
      Version, reason, and session are DERIVED from git on read, never stored: the content commit bumps
      `version` by exactly one and the board row carries that commit's subject as `reason` and its
      `Session:` trailer as `session`; the pure rename bumps NOTHING (a reparent is not a version); both
      reachable side-branch content commits remain versions even though Git's default path simplification
      can hide them behind the TREESAME merge; the parallel old-path edit, renamed-path edit, and base are all
      versions of the current node regardless of branch walk order, with the walk-newest edit supplying its
      reason; reusing the vacated old path starts a separate one-version history while the renamed node keeps
      only its own pre/post-rename versions; and no datastore/hash/index file exists beside the spec tree —
      delete nothing, recompute everything.
---

# measuring source-of-truth

YATU through the real CLI (`spex graph --json`) against an isolated repo: the loss being watched is any drift
between git history and the board's derived facts — a version that doesn't match the content-commit
count, attribution that doesn't come from the `Session:` trailer, a rename that fabricates a version, or
any state file that would make the dashboard a second store instead of a read-time aggregator over git.
