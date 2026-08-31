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
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/data.js]
    related: [spec-dashboard/src/styles.css]
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
  - name: unified-typography-hierarchy
    tags: [frontend-e2e, desktop, mobile]
    description: >
      Open the live dashboard at normal browser zoom in desktop and phone-sized viewports. On desktop,
      visit the graph, sessions, evals, issues, and settings pages; on the phone, visit the specs and
      sessions faces. Capture the settled end state of each representative surface and inspect the
      rendered text hierarchy, density, wrapping, and control alignment.
    expected: >
      The dashboard reads as one product: equivalent titles, controls, body copy, and metadata use a
      consistent hierarchy across every page; ordinary labels remain comfortably legible; secondary
      metadata is quieter without collapsing into tiny text; and no label clips, overlaps, or changes a
      fixed control's geometry. Desktop and phone layouts keep their intended density at normal zoom.
      Zero loss = every visible surface uses the shell's shared type scale without a page-specific
      typographic dialect.
    code: [spec-dashboard/src/styles.css]
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
  - name: applied-frame-is-self-verified
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js]
    related: [packages/spec-core/src/graph-delta.ts]
    description: >-
      Real browser against a live backend. Wrap the page's own EventSource and corrupt exactly ONE
      graph-delta before the data layer sees it — mutate a unit inside `set` while leaving `from` and `to`
      untouched, which is what a server-side diff bug looks like on the wire and is invisible to the chain
      check. Then watch, without reloading: the console, how many board streams the page opens, and every
      /api/graph response with the conditional key it carried.
    expected: >-
      The client detects that applying the patch produced a board the server never had — it fingerprints
      what it now holds and finds it differs from the tag the frame was named with — says so loudly
      (BOARD-DIVERGENCE, naming both tags), and self-heals by reopening onto a fresh anchor, all within a
      second and without a reload. It must NOT quietly absorb the patch: a client that echoes the server's
      tag instead of measuring its own would quote that tag with confidence and be answered a bodyless 304,
      certifying a board nobody holds until the tab is hard-refreshed. Zero loss = a rendered board that is
      not any true server snapshot is observable at the moment it happens, on the cheap lane, rather than
      inferred later or masked by re-downloading the whole graph every poll.
  - name: pushed-board-keeps-poll-bodyless
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/data.js, spec-dashboard/src/App.jsx]
    related: [spec-cli/src/index.ts, spec-cli/src/graphCache.ts]
    description: >-
      Real browser against a live backend on a board that is genuinely moving, so patches actually flow.
      Load the dashboard and watch BOTH channels for ~95 seconds without touching the tab: every
      /api/graph response with the conditional key the request carried, and every push frame the page's
      own EventSource received. For each response that still carries a full body, decompose it into
      units and compare against the board the page was holding at that instant, so a full body is judged
      by what it ADDS rather than by its size.
    expected: >-
      While the push channel is delivering, the fallback poll beside it stays bodyless. Every poll that
      fires once a pushed board is the display carries a conditional key naming that board — the same
      content tag the frame did, because both lanes name a board the same way — and is answered with a
      bodyless 304. A full body is permitted ONLY where it is earned: the boot poll before any board has
      landed, and a poll that catches real divergence, which must then carry units the display genuinely
      lacked (its sibling obligation is push-stale-poll-corrects, which requires exactly that 200). Zero
      loss = no poll ever re-downloads the whole graph while holding every unit of it; the belt behind a
      working stream costs headers, and the cost of the fallback never scales UP with how well the
      primary is working.
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
  - name: theme-preset-switching
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/theme.js, spec-dashboard/src/styles.css, spec-dashboard/index.html]
    description: >-
      Real browser against a live backend, starting with no saved theme choice. Open Settings: the
      theme section must list exactly the nine presets (Minimal, Notion, Things, Tokyo Night, Catppuccin,
      Everforest, Gruvbox, Rosé Pine Dawn, Dracula) —
      no Light, no Dark. Click each preset in turn and visit the graph page under it; then reload
      under the last pick; then clear the saved choice and reload (also under an emulated dark
      prefers-color-scheme to prove the system axis is gone); finally plant a garbage value and each
      legacy value (light, dark) in localStorage spexcode.theme and reload. Watch the console
      throughout.
    expected: >-
      Each preset click re-skins the WHOLE app at once (html[data-theme] flips, the body/graph
      background is that preset's ported --paper value, the settings echo marks the pick) and persists
      as one named code in localStorage spexcode.theme. After a reload the FIRST-PAINT inline script
      has already applied the saved preset before the app module boots (no wrong-palette flash). An
      absent, garbage, or legacy light/dark saved value all resolve to Minimal — data-theme reads
      minimal, the Minimal graphite --paper paints, and the system prefers-color-scheme never
      changes the outcome. No console errors. Zero loss = the presets are pure palette rows over the
      one shared var set (Minimal as the bare :root default): switching, persistence, and the
      Minimal fallback all work with no per-component theme logic and no trace of the retired
      light/dark pair.
---
# dashboard-shell — measurement

YATU: measure through the running dashboard in a real browser (the dev server pointed at a live `spex
serve`), not via a component unit test. The shell's loss is visible only when the whole page mounts — the
root component routes, the data layer has polled the board, and the global stylesheet has applied. File a
screenshot of the loaded graph with `spex yatsu eval dashboard-shell --scenario shell-mounts-both-views
--image <png> --pass`.
