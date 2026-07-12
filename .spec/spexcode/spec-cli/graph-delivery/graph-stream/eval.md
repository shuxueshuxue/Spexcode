---
scenarios:
  - name: rename-nudge
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/index.ts]
    description: >-
      Subscribe to `/api/graph/stream` (plain mode), then POST a rename to `/api/sessions/:id/rename`
      through the real API, and time the arrival of the next stream event.
    expected: >-
      The event arrives on the debounce scale (sub-second), NOT the ~15s cold tick — the rename route's
      explicit nudge (`notifyBoardChanged`, event source 0) reaches the same debounced funnel as every
      watcher. The rename writes the session's global `session.json` (inside the watched store), but the
      store fs.watch is best-effort, so the explicit nudge is what makes the sub-second arrival a
      guarantee rather than watcher luck.
  - name: lifecycle-push-latency
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/graphCache.ts, spec-cli/src/graph.ts]
    description: >-
      With a delta subscriber attached (`curl -N '/api/board/stream?mode=delta'`), watch the per-user
      session store with fs.watch (the truth clock) and time, for REAL worker lifecycle transitions
      (create / propose close / close through the real spex surface), the gap between the session.json
      write and the SSE frame that renders the new status. Aggregate several runs; report the median per
      transition kind.
    expected: >-
      A lifecycle write reaches a delta subscriber in ≤200ms end to end on the dev box: the change signal
      carries its DOMAIN (a store write dirties only the session units), so the push pays a sessions-only
      splice — never a full board rebuild — plus a burst-collapse debounce sized to the measured fs-event
      burst width (tens of ms), not a flat 150ms wait.
  - name: uncommitted-spec-edit-visibility
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    description: >-
      In an isolated fixture project (own SPEXCODE_HOME, own git repo with a .spec tree and one linked
      worktree), start a backend, attach a delta subscriber, then EDIT a governed spec.md inside the
      WORKTREE — uncommitted, and with zero session/hook activity (the human-edit path, so no mark-active
      write rides along to mask the gap). Watch both the SSE stream and a fresh /api/board poll for the
      node's overlay op, for at least 60s.
    expected: >-
      The uncommitted worktree spec edit reaches the board in seconds: the per-worktree `.spec` watcher
      (attached via the `.git/worktrees` registry, for backend-made and hand-made worktrees alike) fires
      an overlay-scoped signal and the edited node gains its overlay op on the next push; a poll sees the
      same fresh board. It must NOT depend on the patrol — and when a watcher is deliberately disabled
      (injection), the patrol must catch the same edit within one ~15s tick AND log the repair with the
      diverged unit keys; a normal run logs zero repairs.
---

# measuring board-stream

YATU through the real HTTP surface: a live `spex serve`, a real `curl -N` SSE subscription, a real rename
POST — never a direct call into the module. The loss is the gap between "a rename shows up while you
watch" and "a rename waits out a cold tick": the nudge must push sub-second even when the best-effort
store watch never attached. (The stream's deeper delta-protocol equivalence is [[graph-delta]]'s own measured contract.)
