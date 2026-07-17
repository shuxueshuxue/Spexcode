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
      always-on poll costs nothing: /api/graph answers the If-None-Match request with a bodyless
      304. Zero loss = no silent-death mode can stall the board past the poll period, and the poll
      that guarantees it is free when the board is quiet.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js]
  - name: dead-stream-self-replacement
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js, spec-dashboard/src/App.jsx]
    description: >-
      Real browser against a live backend with /api routed through a per-connection relay (the
      silent-push-death rig). Once the SSE push channel is established, freeze the relay's established
      pairs WITHOUT closing them (half-open: no FIN, no error event) and watch the CLIENT'S STREAM
      itself, not just the board: does a replacement /api/graph/stream connection ever get opened, and
      does push freshness (sub-second updates on a server change) come back? Note: a CDP page-freeze is
      NOT this failure — a frozen tab's SSE frames buffer at the network layer and flush on resume
      (measured pre-fix: 6/6 freeze runs caught up ≤200ms), so freezing proves nothing about stream death.
    expected: >-
      The client holds the server to its HEARTBEAT CONTRACT (a ping every 10s; silence past 2.5 windows
      = the stream is DEAD, not quiet): within ~30s of the half-open kill it tears the dead EventSource
      down, opens a replacement (visible as a fresh stream connection + a board-full re-anchor), fires
      one refetch, and sub-second push freshness RESUMES. Without the watchdog the dead stream is never
      detected (no FIN, no error event — auto-reconnect never fires) and the board silently degrades to
      15s poll-only freshness FOREVER: the permanent half-alive mode this scenario exists to forbid.
  - name: stale-chunk-recovery
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/App.jsx, spec-cli/src/gateway.ts]
    description: >-
      Serve the BUILT dashboard through the gateway (`spex serve ui` over a live backend). Load it in a
      real browser and stay on the graph page. Rebuild the dist with a source change so the hashed chunk
      names rotate (the deploy-on-merge flow), then — without reloading — click a lazily-loaded page
      (Issues). The running page's index.html still references the OLD chunk hash, which the new dist no
      longer contains.
    expected: >-
      The stale chunk request never strands the page: the gateway answers a missing hashed-asset path with
      404 (never the index.html SPA fallback — an HTML body under a .js request trips the browser's strict
      module-MIME check and masks the miss), the shell catches the failed chunk load (vite:preloadError)
      and reloads once to pick up the fresh index.html, and the clicked page then renders on the routed
      hash. Zero loss = a dist rebuild under a live tab costs one automatic reload, never a dead
      "Failed to fetch dynamically imported module" click; a failure that persists right after that reload
      surfaces as an error instead of a reload loop.
  - name: push-stale-poll-corrects
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js, spec-dashboard/src/App.jsx]
    description: >-
      Real browser against a live backend with ONE online session. Arrange for the push channel to hand
      the client a STALE board — a graph-full that omits the online session — and then go quiet on board
      frames while heartbeat pings keep flowing (the missed-corrective mode behind issue #70: a stale
      connect anchor whose corrective frame is lost; inject by wrapping EventSource to strip the session
      from full frames and drop delta frames, pings passing). Without reloading, watch the sessions page
      and every /api/graph fallback-poll response for at least 75 seconds.
    expected: >-
      The always-on fallback poll CORRECTS push-delivered staleness within about one poll period (≤20s;
      hard wall 75s): the session reappears on the rail and its terminal pane mounts, and the poll answers
      200 (never 304) the moment the displayed board diverges from the server's. The poll's conditional
      key must be the identity of the board actually DISPLAYED — an ETag latched from a fetch that never
      painted (superseded by a pushed board) must not gate it, or the poll 304s forever while the display
      stays stale and the pane's only recovery is a hard refresh: the blackhole this scenario forbids.
      Zero loss = no interleaving of pushed boards and in-flight fetches leaves the 304 lane certifying a
      board nobody is seeing.
  - name: idle-heartbeat-costs-nothing
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js, spec-dashboard/src/heartbeat.js]
    description: >-
      Real browser against a live backend, with every setInterval/setTimeout registration and firing
      instrumented (an init script wrapping the timer APIs, attributing each by call stack). Load the
      dashboard, let the board render and the push stream establish, then leave the tab completely idle
      for ≥35s (longer than one dead window) and read the census: which intervals the stream watchdog
      registered, and how many times any data-layer timer FIRED during the idle window.
    expected: >-
      The stream's liveness watchdog is a dead-man switch, not a polling loop: it registers NO
      setInterval (the only interval left is the 15s fallback poll, which is a different belt), and
      during the whole idle window ZERO data-layer watchdog timers fire — every inbound stream event
      (pings included) re-arms a one-shot that never gets to fire on a healthy link. The dead window
      stays 2.5× the server ping cadence, derived from the ONE shared cadence primitive both the SSE
      board stream and the terminal socket read (heartbeat.js). Zero loss = liveness detection costs
      zero wakeups while the link is healthy, and a silent stream death still reopens within one dead
      window (the same census rig, with the backend's pings frozen, must show a replacement
      /api/graph/stream connection).
---
# dashboard-shell — measurement

YATU: measure through the running dashboard in a real browser (the dev server pointed at a live `spex
serve`), not via a component unit test. The shell's loss is visible only when the whole page mounts — the
root component routes, the data layer has polled the board, and the global stylesheet has applied. File a
screenshot of the loaded graph with `spex yatsu eval dashboard-shell --scenario shell-mounts-both-views
--image <png> --pass`.
