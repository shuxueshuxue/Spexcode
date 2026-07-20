---
scenarios:
  - name: rail-routes-pages
    tags: [frontend-e2e, desktop]
    description: >
      Open a scoped dashboard through the real hub gateway with catalog access. The rail shows the
      current-project chip and FIVE project page entries, with no Projects button. Click each in turn
      (graph → sessions → evals → issues → settings) and read location.hash after each click; press the
      browser Back button; deep-load #/settings directly; then navigate to the legacy
      /p/<id>/#/projects address.
    expected: >
      The scoped rail carries the current-project chip plus five page entries (graph, sessions, evals,
      issues, settings — evals above issues), never a Projects page entry. Each click swaps the main area
      to that page and the hash reads #/graph, #/sessions/…, #/evals, #/issues, #/settings respectively,
      with the clicked rail entry accented; Back returns to the previous page; a direct load at #/settings
      opens on the settings page (no flash through the graph). The legacy scoped projects hash performs
      one full-page redirect to `/projects`, where the global management page renders. Zero loss = the
      scoped rail, the URL, and the visible page never disagree while project management has one home.
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js]
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
    code: [spec-dashboard/src/App.jsx, spec-dashboard/src/Dashboard.jsx, spec-dashboard/src/SideBar.jsx]
  - name: global-alt-vocabulary
    tags: [frontend-e2e, desktop]
    description: >
      In a real browser, exercise the global ⌥ command family from every page: ⌥1..⌥5 (physical digits)
      must land on graph/sessions/evals/issues/settings, ⌥N on the New Session composer (its pill
      accented), ⌥F on evals (the leading loss surface) — including when pressed FROM the session board.
      Also press bare `f` on the graph and read the hash. Then press Esc on the session board and on the
      evals + issues pages and read location.hash. Check a rail tooltip carries its ⌥ hint, and that the
      console's top row has exactly the ＋ pill (the old issues pill is gone).
    expected: >
      Every ⌥ chord routes to its page regardless of the page it was pressed on (⌥3 → #/evals, ⌥4 →
      #/issues, ⌥5 → #/settings); ⌥F and bare `f` both land on #/evals; Esc changes NO page's hash (it
      only closes in-page overlays); the rail tooltips read e.g. "Spec Node Graph (⌥1)" and "Evals (⌥3 /
      ⌥F)"; the session-list top row holds a single ＋ pill; the console is clean. Zero loss = one global
      switch vocabulary, and Esc demoted to overlay-closer everywhere.
    related: [spec-dashboard/src/App.jsx, spec-dashboard/src/SessionInterface.jsx]
---
# side-nav — measurement

YATU: drive a real headless browser against the running dashboard — click the actual rail buttons and
read `location.hash` + the rendered page from the DOM, never from reasoning about the router. File with
`spex eval add side-nav --scenario rail-routes-pages --video <webm> --pass|--fail`.
