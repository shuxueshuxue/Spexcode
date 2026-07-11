---
scenarios:
  - name: manifest-equals-legacy-map
    tags: [backend-api]
    description: >-
      Compile the surface:hook nodes to the persistent manifest (`spex materialize`) and compare to the
      legacy event→script map.
    expected: >-
      The manifest is exactly UserPromptSubmit→mark-active; PreToolUse→mark-active(order 10)+spec-first(order
      20, block) in that order; PostToolUse→spec-of-file; Stop→stop-gate(block); StopFailure→session-fail;
      Notification→idle — one line per (node × event), sorted by event then order.
  - name: per-tree-manifest-isolation
    tags: [backend-api]
    description: >-
      Two worktrees of one project diverge in `.config`: tree B adds a `surface: hook` node bound to
      SessionStart (a marker script), tree A stays stock. Materialize B, then materialize A (A materializes
      LAST),
      then fire a SessionStart dispatch with cwd = B.
    expected: >-
      B's dispatch runs B's OWN compiled hook set — the marker fires — because each tree's manifest lives in
      its own slot (`<runtime>/trees/<enc-worktree>/hooks-manifest`), keyed by the dispatching tree's
      `rev-parse --show-toplevel`. A's later materialize lands in A's slot and can never overwrite what B's
      sessions dispatch (the old single global slot was last-writer-wins across trees).
  - name: pre-slot-tree-falls-back-to-legacy-manifest
    tags: [backend-api]
    description: >-
      Simulate a worktree from before the per-tree slots: no `trees/<enc>` slot exists for it, but the legacy
      global `<runtime>/hooks-manifest` (a pre-migration materialize left it) is present. Fire a dispatch from that tree,
      then run any git-native anchor (`spex materialize`) in it and dispatch again.
    expected: >-
      The slot-less dispatch falls back to the legacy global manifest — hooks (Stop gate included) keep
      firing through the migration window, never silently no-op. After the anchor plants the tree's slot,
      dispatch reads the slot and the legacy file is dead residue (never rewritten, swept by uninstall).
  - name: block-decision-passes-through
    tags: [backend-api]
    description: >-
      Drive a PreToolUse event for a session that should be nudged (first code access, spec untouched), so
      spec-first emits its decision. Capture the dispatcher's stdout/exit.
    expected: >-
      The dispatcher passes spec-first's `{"decision":"block","reason":…}` stdout through UNCHANGED and
      exits 2 — a block:true handler's JSON decision or its own exit 2 both raise the dispatch exit, the one
      signal both harnesses propagate, with the stdout JSON as the reason payload (per the governing spec).
      mark-active still ran (its side effect happened) regardless of spec-first's block — all handlers run.
---
# eval.md — hook-dispatch

The dispatch layer is measured through the real session round-trip (YATU). Invariants: the persistent
manifest equals the legacy map (so dashboard hooks are unchanged); a dispatch reads the manifest of ITS OWN
worktree (per-tree slots — two trees with divergent `.config` never trade hook sets), with the legacy
global manifest as the migration-window fallback for a not-yet-slotted tree; real blocking rides the stdout
decision JSON the dispatcher passes through verbatim. Measure the manifest by byte-diff; measure isolation
by materializing two divergent trees and dispatching from each.
