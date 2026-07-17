---
scenarios:
  - name: stream-survives-public-gateway
    tags: [frontend-e2e, backend-api]
    code: spec-cli/src/reaper.ts
    related: [spec-cli/src/gateway.ts, spec-cli/src/graphStream.ts, spec-dashboard/src/SessionTerm.jsx]
    description: >-
      Through a REAL TLS `--public` gateway (the deployed dashboard's actual surface — https, password
      login), open the dashboard in a real browser, switch to the session interface with a live terminal,
      and HOLD for minutes with WebSocket/EventSource lifecycles instrumented and the reconnecting caption
      observed. Both push channels (`/api/graph/stream?mode=delta` SSE, `/api/sessions/:id/socket` WS) are
      actively heartbeating (10s ping contract), so nothing on the wire is idle.
    expected: >-
      Zero unsolicited drops for the whole hold: no SSE error/re-open cycles, no WS close code=1006 waves,
      and the loud "reconnecting…" caption never appears. Connection reaping applies to slow-loris and idle
      keep-alive sockets ONLY, identically on the TLS gateway and the plain-HTTP child — an armed deadline
      must always be reachable (and disarmed) from the socket a request/upgrade actually reports, never
      stranded on a wrapped socket the reaper can no longer see.
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
  - name: resubscribe-anchor-current
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    description: >-
      Against a live backend (isolated fixture project), attach a delta subscriber (`curl -N
      '?mode=delta'`) and let it anchor (receive its graph-full), then DISCONNECT it so the backend has
      zero delta subscribers. During that zero-subscriber gap, change the board through the real spex
      surface (create a session). Then attach a NEW delta subscriber and read the FIRST board frame it is
      anchored on, against a concurrent fresh /api/graph poll.
    expected: >-
      The first graph-full a new-era subscriber anchors on reflects the CURRENT board — it contains the
      gap-time change (the created session), same as the concurrent /api/graph poll. It must NOT be a
      cached frame from the previous subscriber era: with no delta subscriber nothing rebuilds, so a kept
      anchor is arbitrarily stale, and a client that rebuilds its warm-terminal set from it drops live
      sessions' panes and then leans entirely on recovery lanes that can themselves latch (issue #70 —
      dashboard-shell's poll-corrects scenario is the client half). Zero loss = the anchor era dies with
      its last subscriber; a new era's first frame is a fresh build, never an heirloom.
---

# measuring board-stream

YATU through the real HTTP surface: a live `spex serve`, a real `curl -N` SSE subscription, a real rename
POST — never a direct call into the module. The loss is the gap between "a rename shows up while you
watch" and "a rename waits out a cold tick": the nudge must push sub-second even when the best-effort
store watch never attached. (The stream's deeper delta-protocol equivalence is [[graph-delta]]'s own measured contract.)
