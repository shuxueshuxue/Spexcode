---
scenarios:
  - name: migrate-on-first-touch
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/src/git.ts]
    description: >-
      A scratch repo whose store is the pre-rename `.spec/.forum/` holding several committed threads (one
      with a multi-post reply history), and no `.spec/.issues/`. Run the toolchain's first store touch — a
      read (`spex issues --all`) — then inspect the trunk.
    expected: >-
      The touch renames the store: `.spec/.forum` is gone, `.spec/.issues` holds every thread, and exactly
      one commit `issues: store dir .spec/.forum → .spec/.issues` sits on the trunk (a git-detected rename,
      not add+delete). `git log --follow` on a migrated thread traces through the rename into its whole
      pre-rename history, and `spex issues --all` reads the thread — including every reply — identically to
      before. The read that triggered the migration returns the full store, never an empty one.
  - name: fresh-creates-issues
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    description: >-
      A fresh repo with neither `.spec/.forum/` nor `.spec/.issues/`. Open the first local issue
      (`spex issues open "<concern>"`).
    expected: >-
      No migration runs (nothing to move); the first write creates `.spec/.issues/` and commits the thread
      there. `.spec/.forum/` is never created. The fast path costs no store lock when there is no legacy dir.
  - name: both-exist-fails-loud
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    description: >-
      A pathological repo carrying BOTH `.spec/.forum/` and `.spec/.issues/`. Run any store touch.
    expected: >-
      The store refuses to guess: it fails LOUD with an error naming both directories and the manual repair
      (reconcile threads into `.spec/.issues`, remove `.spec/.forum`, re-run) — it never silently merges or
      picks one, so no thread can be dropped.
  - name: concurrent-first-touch
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    description: >-
      A pre-rename repo (`.spec/.forum/` with threads), then fire many store touches concurrently as the
      very first touch after the update (a burst of `spex issues open`/`spex issues`).
    expected: >-
      Exactly ONE rename commit lands (the store lock serializes the find-check-move; the racers that waited
      re-check under the lock and find the move already done). No duplicate rename, no lost thread, no
      corrupted store; every concurrent write that followed the migration is committed under `.spec/.issues/`.
---
# measuring issues-store-rename

YATU through the real `spex` CLI and real `git`, in throwaway repos so a measurement never writes the live
trunk. The migration's whole value is that a real deployment renames itself without losing data, so the
proof drives the same first-touch an updated deployment hits — a plain `spex issues`/`spex issues open` — and
reads the outcome from `git log --follow` and the on-disk directory, never from an internal helper. The A/B
that matters is the reply history: identical before and after the rename is the evidence the git-mv (not a
copy) preserved the database.
