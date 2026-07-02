---
scenarios:
  - name: rail-routes-pages
    tags: [frontend-e2e, desktop]
    description: >
      Open the dashboard in a real browser at a live backend. Click each rail entry in turn (graph →
      sessions → forum → settings) and read location.hash after each click; then press the browser Back
      button; then deep-load the app at #/settings directly.
    expected: >
      Each click swaps the main area to that page and the hash reads #/graph, #/sessions/…, #/forum,
      #/settings respectively, with the clicked rail entry accented; Back returns to the previous page;
      a direct load at #/settings opens on the settings page (no flash through the graph). Zero loss =
      the rail, the URL, and the visible page never disagree.
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js]
---
# side-nav — measurement

YATU: drive a real headless browser against the running dashboard — click the actual rail buttons and
read `location.hash` + the rendered page from the DOM, never from reasoning about the router. File with
`spex yatsu eval side-nav --scenario rail-routes-pages --image <png> --pass|--fail`.
