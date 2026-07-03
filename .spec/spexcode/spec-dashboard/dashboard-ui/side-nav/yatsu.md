---
scenarios:
  - name: rail-routes-pages
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard in a real browser at a live backend. Click each rail entry in turn (graph →
      sessions → issues → settings) and read location.hash after each click; then press the browser Back
      button; then deep-load the app at #/settings directly.
    expected: >
      Each click swaps the main area to that page and the hash reads #/graph, #/sessions/…, #/issues,
      #/settings respectively, with the clicked rail entry accented; Back returns to the previous page;
      a direct load at #/settings opens on the settings page (no flash through the graph). Zero loss =
      the rail, the URL, and the visible page never disagree.
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js]
  - name: global-alt-vocabulary
    tags: [frontend-e2e, desktop]
    description: >
      In a real browser, exercise the global ⌥ command family from every page: ⌥1..⌥4 (physical digits)
      must land on graph/sessions/issues/settings, ⌥N on the New Session composer (its pill accented),
      ⌥F on issues — including when pressed FROM the session board. Then press Esc on the session
      board and on the issues page and read location.hash. Check a rail tooltip carries its ⌥ hint, and that
      the console's top row has exactly the ＋ pill (the forum pill is gone).
    expected: >
      Every ⌥ chord routes to its page regardless of the page it was pressed on; Esc changes NO page's
      hash (it only closes in-page overlays); the rail tooltips read e.g. "Spec Node Graph (⌥1)"; the
      session-list top row holds a single ＋ pill; the console is clean. Zero loss = one global switch
      vocabulary, and Esc demoted to overlay-closer everywhere.
    related: [spec-dashboard/src/App.jsx, spec-dashboard/src/SessionInterface.jsx]
---
# side-nav — measurement

YATU: drive a real headless browser against the running dashboard — click the actual rail buttons and
read `location.hash` + the rendered page from the DOM, never from reasoning about the router. File with
`spex yatsu eval side-nav --scenario rail-routes-pages --image <png> --pass|--fail`.
