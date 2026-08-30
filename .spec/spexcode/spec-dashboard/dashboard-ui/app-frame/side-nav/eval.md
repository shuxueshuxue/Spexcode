---
scenarios:
  - name: rail-sessions-is-a-mode-button
    description: >-
      In the running desktop dashboard, inspect the rail on the graph page and then open the bare
      `#/sessions` launch hero directly by address. Inspect the rail DOM in each state and take a settled
      screenshot of the one-layer icon rail.
    expected: >-
      The live rail has Explorer, Sessions, and Search buttons, plus graph/evals/issues/settings anchors;
      it has no `href="#/sessions"` anchor. Clicking Sessions changes only dock visibility/projection and
      never the hash. A direct `#/sessions` load still reaches the sessions launch hero, preserving
      address navigation's deliberate asymmetry. The rail remains one 40px icon strip with no dock
      modebar duplicated beside it.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/Shell.jsx]
    related: [spec-dashboard/src/styles.css]
  - name: rail-routes-pages
    tags: [frontend-e2e, desktop]
    description: >
      Open a scoped dashboard through the real hub gateway with catalog access. The rail shows FIVE
      project page entries and its dock toggle, with no project chip or Projects button. Confirm the
      compact project identity button is instead in the status row, then click each route in turn
      (spec → sessions → evals → issues → settings) and read location.hash after each click; press the
      browser Back button; deep-load #/settings directly; then navigate to the legacy
      /p/<id>/#/projects address.
    expected: >
      The scoped rail carries five page entries (spec, sessions, evals, issues, settings — Spec first and
      evals above issues), never a project chip or Projects page entry. The status row alone carries the current
      project mark/name button. Each route click swaps the main area
      to that page and the hash reads #/spec, #/sessions/…, #/evals, #/issues, #/settings respectively,
      with the clicked rail entry accented; Back returns to the previous page; a direct load at #/settings
      opens on the settings page (no flash through the graph). The desktop rail is 40px wide and its
      centered route targets stay 32px square. The legacy scoped projects hash performs one
      full-page redirect to `/projects`, where the global management page renders. Zero loss = the scoped
      rail, the URL, and the visible page never disagree while project management has one home.
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js]
    related: [spec-dashboard/src/styles.css]
    test: spec-dashboard/test/identity-chain.e2e.mjs
  - name: spec-rail-resident-dock
    description: >-
      In a real Chromium dashboard, open `#/spec`, inspect the five top-level rail anchors and selected
      state, then open a governed file route and finally the Issues board. Read the route hash, rail
      `aria-current`, Explorer section heads, and whether the left rail/dock exists.
    expected: >-
      `#/spec` shows Spec, Sessions, Evals, Issues, and Settings as peer rail anchors, with only Spec
      selected and the Explorer dock exposing exactly Specs and Files. `#/file/<path>` keeps Spec selected
      and the same two Explorer sections. `#/issues` keeps the same rail with Issues selected, no fold
      control, and no Explorer dock: the board takes the whole width right of the rail.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js, spec-dashboard/src/Shell.jsx]
    test: spec-dashboard/test/spec-rail.e2e.mjs
  - name: ownership-audit-session-focus-and-document-names
    tags: [frontend-e2e, desktop]
    description: >-
      In real Chromium, open Sessions A and B as two tabs (ctrl/⌘-click B), focus A, then click B in the
      routed Sessions forest. Also inspect the rail labels and visit a Spec node and governed file route.
    expected: >-
      Clicking open B focuses B's existing workspace tab without rewriting A; active hash, tab, title, and
      content all name B while A remains open. The routed Sessions document has no duplicate dock body.
      The rail order is Spec, Sessions, Evals, Issues, Settings and Spec's label/tip are localized. The
      Spec detail keeps one Spec-icon tab while its face, tooltip, aria-label, and title use the node title;
      file focus uses its file title and creates no second Spec tab.
    code: [spec-dashboard/src/tabs.js, spec-dashboard/src/Dock.jsx, spec-dashboard/src/SessionsView.jsx, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/test/ownership-audit.e2e.mjs
  - name: offline-switcher-is-inert
    tags: [frontend-e2e, desktop]
    description: >
      Through the real multi-project gateway, open a still-running project's scoped dashboard while a
      second catalog project is explicitly offline. Open the status-row project identity button and inspect both rows,
      then press the offline row and read the pathname.
    expected: >
      The online row is visibly marked online and remains a native project link. The offline row remains
      visible but is visibly marked offline, has `aria-disabled="true"`, no `href`, and no navigation
      action; pressing it leaves the still-running project's pathname unchanged. The global All projects
      row remains the available door to start the stopped backend. Zero loss = the switcher never sends a
      user into a project scope whose backend is known to be stopped.
    code: [spec-dashboard/src/Shell.jsx]
  - name: resolved-identity-head
    tags: [frontend-e2e, desktop]
    description: >
      Boot the dashboard cold on #/sessions in a real browser while sampling every document.title and
      favicon-link href write frame-by-frame (rAF + head MutationObserver), across: scoped custom-icon,
      GLOBAL custom-icon (direct serve — no catalog), scoped default-icon, and with /api/graph delayed
      2.5-3s. Then cycle graph → sessions → evals → issues with a lazy page chunk delayed 1.5s, watching
      the main area, the head, and history.length; audit what element each rail entry is.
    expected: >
      The head carries ONLY resolved identity: no frame ever shows the default mark or the raw project id
      as a placeholder — a cold boot goes straight from the static boot document (empty icon href, bare
      SpexCode title) to the real title + icon in one write, at ANY board/catalog latency. Hash navigation
      and lazy/loading intermediates never rewrite the favicon href or unmount the shell; a page whose
      chunk is still arriving shows the shared in-pane loading state, never a blank main area, with the
      same pane for all four pages (warm pages display-toggle). Every rail entry is a real anchor
      (href = its page's hash address). Zero loss = the tab's identity never flashes through the SpexCode
      default on entering Sessions (or any page), and the four routes share one navigation transaction.
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/GraphView.jsx, spec-dashboard/src/SideBar.jsx]
  - name: global-alt-vocabulary
    tags: [frontend-e2e, desktop]
    description: >
      In a real browser, exercise the global ⌥ command family from every page: ⌥N on the New Session
      composer (its pill accented), ⌥F on evals (the leading loss surface), ⌥/ on the search palette —
      including when pressed FROM the session board. Then press ⌥1 through ⌥5 (physical digits) on each
      page and read location.hash after every press. Also press bare `f` on the graph and read the hash.
      Then press Esc on the session board and on the evals + issues pages and read location.hash. Read
      every rail tooltip.
    expected: >
      Each NAMED ⌥ chord reaches its destination regardless of the page it was pressed on; ⌥F and bare `f`
      both land on #/evals. No ⌥+digit changes location.hash on any page — the positional page row was
      withdrawn ([[keyboard-nav]]), so a digit reaches no shell action anywhere. Esc changes NO page's hash
      (it only closes in-page overlays). No rail tooltip prints a digit hint: only Evals carries one, and
      it reads "⌥F". Zero loss = the shell advertises exactly the keys it still fires, and Esc stays an
      overlay-closer everywhere.
    related: [spec-dashboard/src/App.jsx, spec-dashboard/src/SessionInterface.jsx]
  - name: rail-on-every-board-and-fold-follows-sidebar
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop Chromium against the running dashboard, open `#/sessions`, `#/spec`, `#/evals`,
      `#/issues`, and `#/settings` in turn; on each read whether the `.side-rail` is visible and whether it
      carries the `.rail-panel-toggle` control. On `#/sessions` press the control and read the forest
      (`.si-list`) visibility and the control's `aria-pressed`; move to `#/spec` and read the Explorer
      dock; return to `#/sessions` and press the control again.
    expected: >-
      The rail is visible on all five routes. The fold control is present exactly where a sidebar exists
      to fold — `#/sessions` (the document's forest) and `#/spec` (the Explorer dock) — and absent on the
      bare Evals, Issues, and Settings boards. On `#/sessions` the first press hides the forest and flips
      `aria-pressed` to false; `#/spec` then shows no Explorer dock, because Spec and Sessions fold from
      the same open/closed state; back on `#/sessions` the second press restores the forest and
      `aria-pressed` returns to true. Zero loss = one fold control, one state, every board reachable.
    code: [spec-dashboard/src/Shell.jsx, spec-dashboard/src/SideBar.jsx, spec-dashboard/src/SessionInterface.jsx]
---
# side-nav — measurement

YATU: drive a real headless browser against the running dashboard — click the actual rail buttons and
read `location.hash` + the rendered page from the DOM, never from reasoning about the router. File with
`spex eval add side-nav --scenario rail-routes-pages --video <webm> --pass|--fail`.
