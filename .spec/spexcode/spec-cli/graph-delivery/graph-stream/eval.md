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
      watcher. The rename commits canonical session state; the runtime envelope is `runtime.json` inside the watched store, but the
      store fs.watch is best-effort, so the explicit nudge is what makes the sub-second arrival a
      guarantee rather than watcher luck.
  - name: lifecycle-push-latency
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/graphCache.ts, packages/spec-core/src/graph.ts]
    description: >-
      With a delta subscriber attached (`curl -N '/api/board/stream?mode=delta'`), watch the per-user
      session store with fs.watch (the truth clock) and time, for REAL worker lifecycle transitions
      (create / propose close / close through the real spex surface), the gap between the canonical SQLite
      transition and the SSE frame that renders the new status. Aggregate several runs; report the median per
      transition kind.
    expected: >-
      A lifecycle write reaches a delta subscriber in ≤200ms end to end on the dev box: the change signal
      carries its DOMAIN (a store write dirties only the session units), so the push pays a sessions-only
      splice — never a full board rebuild — plus a burst-collapse debounce sized to the measured fs-event
      burst width (tens of ms), not a flat 150ms wait.
  - name: hook-authored-state-push
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/graphCache.ts, spec-cli/src/session-application.ts, .spec/spexcode/.plugins/core/mark-active/mark-active.sh]
    description: >-
      Against an isolated-home backend serving a real spec corpus with one governed session, hold BOTH a plain
      `/api/graph/stream` and a delta subscriber, then commit lifecycle transitions from ANOTHER PROCESS through
      the hook's own writer — `spex internal session-state <state> --session <id>`, exactly what mark-active runs
      on UserPromptSubmit/PreToolUse and what the stop-gate's declarations run — with zero tmux, route, or
      envelope activity riding along. Time the first non-ping stream event after each commit and poll
      `/api/graph` for the row's status.
    expected: >-
      Each hook-authored commit reaches both subscribers on the debounce scale (sub-second) and the next
      `/api/graph` read carries the new status: the canonical session database is a watched leaf feeding the
      sessions splice, so a flip written by the hook's process shows exactly like one the backend committed
      itself — never waiting for an unrelated tmux/ref/worktree signal, and never for the patrol (zero
      `PATROL-REPAIR` for these commits).
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
  - name: watcher-registry-lifecycle
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/index.ts]
    description: >-
      In an isolated production-shaped git fixture, start the real backend and plain graph SSE, repeatedly
      invalidate/build while live worktrees are added and removed from the observed set, then make three
      consecutive commits. Count this backend process's inotify watch descriptors after every reconciliation,
      observe each commit through SSE plus the `/api/graph` freshness header, close/reopen the watcher era,
      and finally terminate the backend by its exact port.
    expected: >-
      Watch cardinality follows the canonical roots being observed, not the corpus inside them, and plateaus
      across unchanged refreshes; removed paths and close return their handles, reopen starts one clean
      registry per root/scope, and process exit returns the count to zero. Each of the three commits causes
      exactly one `stale, refreshing` -> `fresh` cycle and one non-overlapping build. Registration/runtime
      failures are visible with their source path and errno and never leave a half-attached or silently-deaf
      registry.
  - name: served-project-first-spec-visibility
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/graphStream.api.test.ts]
    description: >-
      In isolated served Git projects whose roots start with no `.spec` directory — including a zero-commit
      `git init` repository and an unrecorded linked worktree — start the real backend and warm `/api/graph`
      to a fresh zero-node response. Without a delta subscriber or restart, create a valid served-project
      `.spec` node and poll the real graph API. Then attach plain
      `/api/graph/stream`, delete that node, create and delete another, and observe each plain signal plus
      the following fresh HTTP graph. Count the actual backend generation's Linux inotify entries (where
      available) and the backend census before creation and after final deletion.
    expected: >-
      The served project root is registered as a canonical graph root even when `.spec` did not exist at
      server startup, and an unborn `HEAD` supplies an empty historical projection rather than a 500: every
      creation/deletion promptly converges through ordinary root events, never the
      delta-only cold patrol, and `/api/graph` never calls an absent subtree `fresh`. A linked-worktree backend
      observes its own root, not the common-dir checkout. The plain stream reports the same
      changes, and the observer set returns to its warmed plateau after the subtree is removed — no duplicate
      root registrations or leaked handles remain.
  - name: failed-refresh-keeps-trigger-attribution
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    related: [spec-cli/src/graphCache.ts, spec-cli/src/graphStream.api.test.ts]
    description: >-
      In an isolated real backend, attach a delta subscriber and let it anchor. Make a governed spec/ref
      change while a controlled git history child is wedged so the board watchdog aborts that refresh; while
      the failed flight is still occupied, change a session record through the watched store. Release the
      wedge but issue no second invalidation and make no fresh graph request: wait for the existing cold
      patrol to recover the cache, then inspect the SSE frame, final graph and debug attribution.
    expected: >-
      The failed producer restores its consumed full scope, and the next patrol completes one fresh graph
      containing both changes without any manual invalidation. When the session-only projection successfully
      publishes before the watchdog fails the structural producer, its earlier trigger ledger is `{full,
      sessions}` and it consumes that sessions cause; the later structural recovery is ordered after it and
      carries `{full, patrol}`. It must NOT emit PATROL-REPAIR: the patrol recovered work already attributed
      to healthy leaf signals, so calling that a blind-watcher repair is false. The stream must not swallow the
      rebuild or any trigger that remains owed while the failed flight was occupied.
  - name: adopter-scale-watch-budget
    tags: [backend-api]
    code: spec-cli/src/graphStream.ts
    description: >-
      PLATFORM PREMISE — these counts belong to the consolidated-recursive transport, not to the product
      everywhere: a host with no subtree observer (Linux, exact-directory) registers per directory by
      design, so its numbers differ in kind, and judging them against this expected reads a transport
      difference as a regression. Answer which transport the host is on before judging, and record that
      answer with the reading.
      On a machine whose platform observes a subtree from ONE registration (macOS/FSEvents), build an
      adopter-shaped isolated fixture — 444 spec nodes, 53 linked worktrees whose sessions are non-offline,
      30 session records, its own SPEXCODE_HOME and a verified-free port — and start the real backend
      against it. Read the live watcher census and the process's descriptor count after the initial attach
      and after every reconciliation, then run three rounds of real change (a commit, a ref move, an
      uncommitted spec edit) through `/api/graph` and the SSE stream, sampling the whole backend process
      tree's RSS throughout.
    expected: >-
      The backend attaches the whole corpus with ZERO registration errors and holds a registration count on
      the order of the canonical roots (two per live worktree plus the store/refs/registry roots) — never one
      per spec-node directory, which at this shape asks for 23,532 and is answered with a process-wide EMFILE
      that leaves every watcher deaf while resident memory climbs into the gigabytes with no git child alive.
      Census and descriptor counts plateau across unchanged reads. Each of the three rounds is observed
      server-side as `stale, refreshing` -> `fresh`, `/health` stays 200 throughout, the backend tree's peak
      RSS stays under 786432 KB, and no backend child is left behind on exit.
---

# measuring board-stream

YATU through the real HTTP surface: a live `spex serve`, a real `curl -N` SSE subscription, a real rename
POST — never a direct call into the module. The loss is the gap between "a rename shows up while you
watch" and "a rename waits out a cold tick": the nudge must push sub-second even when the best-effort
store watch never attached. (The stream's deeper delta-protocol equivalence is [[graph-delta]]'s own measured contract.)
