---
scenarios:
  - name: shell-mounts-both-views
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard in a browser pointed at a live backend. Confirm the root shell mounts: the
      left navigation rail is visible, the spec-graph view renders the project's node tree as tiles
      with the HUD/brand strip visible, and switching to the session-board page (via the nav rail) and
      back works, the URL hash tracking each switch. Watch the browser console for errors.
    expected: >
      The graph renders the root node and its children with the rail + HUD present; both top-level pages
      (graph and sessions) are reachable and interactive (node click / pan-zoom responds) and the hash
      reads #/graph / #/sessions/… as they switch; the console shows no errors. Zero loss = the shell,
      its polled data layer, and the global styles all load and render.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js, spec-dashboard/src/styles.css]
  - name: board-unreachable-shows-retry
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard with its /api proxy pointed at a DEAD backend port (no spex serve). Wait past
      the first board fetch. The page must show the fail-loud boot panel — an error message plus a retry
      button — instead of sitting on the "loading…" spinner forever. Then bring a backend up on that
      port (or repoint) and click retry: the board loads.
    expected: >
      With no reachable backend the shell renders the load-error panel (error text + a retry button),
      never an eternal spinner; a retry once the backend is reachable lands the board. Zero loss = a
      dead backend is legible at a glance and recoverable without a manual page reload.
    code: [spec-dashboard/src/App.jsx]
  - name: silent-push-death-self-heals
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard in a real browser against a live backend, with /api routed through a
      per-connection relay. Once the board has rendered and the SSE push channel is established,
      freeze the relay's established pairs WITHOUT closing them (no FIN, no error event — a
      half-open tunnel / sleep-resume / network-switch death; new connections still pass), then
      change the board server-side (add a spec node). Watch the rendered board without reloading.
    expected: >
      The board reflects the change within ~15s (one fallback-poll period) — a silently dead push
      channel degrades to poll freshness, never to a frozen board. And while nothing changes, the
      always-on poll costs nothing: /api/board answers the If-None-Match request with a bodyless
      304. Zero loss = no silent-death mode can stall the board past the poll period, and the poll
      that guarantees it is free when the board is quiet.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js]
  - name: hidden-tab-catchup
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js, spec-dashboard/src/App.jsx]
    description: >-
      Real browser via CDP: load the dashboard, confirm the board renders, then FREEZE the page
      (Page.setWebLifecycleState 'frozen' — the background-tab / Memory-Saver state where no JS runs).
      While frozen, change a session's state server-side (a real rename or lifecycle write). Unfreeze
      (visible again) and time how long the rendered DOM takes to reflect the change. Separately, kill
      the SSE connection silently mid-run (half-open, no FIN) with the page visible and verify recovery.
    expected: >-
      On becoming visible the board catches up within ~1s: the client holds the server to its HEARTBEAT
      CONTRACT (a ping on a promised cadence; more than two windows of silence = the stream is dead —
      tear it down, reopen, refetch once). A frozen tab's overdue watchdog fires immediately on resume,
      so the catch-up never waits out a 15s poll tick and a silently-dead stream while visible is
      replaced within one heartbeat window — no indefinite stale board (the measured failure: 73s of
      frozen DOM while the backend pushed fresh states).
---
# dashboard-shell — measurement

YATU: measure through the running dashboard in a real browser (the dev server pointed at a live `spex
serve`), not via a component unit test. The shell's loss is visible only when the whole page mounts — the
root component routes, the data layer has polled the board, and the global stylesheet has applied. File a
screenshot of the loaded graph with `spex yatsu eval dashboard-shell --scenario shell-mounts-both-views
--image <png> --pass`.
