---
scenarios:
  - name: evals-page-master-detail
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/SideBar.jsx]
    description: >
      Open the dashboard in a real browser at a live backend. Click the Evals rail entry (or press ⌥3 / f
      from the graph) and read location.hash + the rendered page. Read the master-detail shell: the
      two-column grid and the LIST COLUMN'S MEASURED WIDTH, the left [[evals-feed]] list with its filter
      chipbar (NO tab switcher), the right detail pane. Click the fold toggle and re-measure the columns;
      unfold. Select an eval row and read what the RIGHT pane renders; drive j/k in the feed and read
      that the selection + detail follow; finally reload the app directly at #/evals.
    expected: >
      The hash reads #/evals and the Evals rail entry is accented. The page is a two-column master-detail
      whose LEFT column is SLIM — title-only rows, at most ~280px, the detail visibly the protagonist —
      the evals feed (latest reading per scenario, its own kind chips in a sticky head) with NO
      Evals|Threads switcher; the RIGHT pane is the full-height [[event-detail]] of the selection. The
      fold toggle collapses the list to a thin strip (the detail takes essentially the full width); the
      strip unfolds it, with filters and selection intact. Selecting an eval row renders it in the RIGHT
      pane as the event detail workspace (media stage + A/B strip in the header + the remark rail) —
      selection IS detail, no in-place expansion in the list. j/k move ONE selection in the feed and the
      detail follows. A direct reload at #/evals opens on the Evals page (hash routing intact — no flash
      through the graph). Zero loss = the Evals page is a real top-level route with its own master-detail
      whose slim, foldable list never starves the detail.
  - name: canonical-eval-url
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/EvalsFeed.jsx]
    description: >
      In a real browser at a live backend: on #/evals select an eval row and read location.hash. j/k to
      another row and read the hash again, then check history.length did not grow per hop (the echo
      replaces). Copy the hash, open it directly in a FRESH page load (#/evals/<node>/<scenario>), and read
      which eval the detail pane renders. Then deep-link an eval whose evidence kind the feed's DEFAULT
      filter would hide (e.g. an image/note eval while the video chip is the default) and read the feed's
      active kind chip + the rendered detail. Finally load a made-up address (#/evals/no-such/nope) and
      read the hash + detail after the feed settles.
    expected: >
      Every selection is ECHOED into the address bar as #/evals/<node>/<scenario> (replace — row-hopping
      buries no history entries), so the shown eval is always shareable by copy-URL. A fresh load at a
      canonical address opens the Evals page with EXACTLY that (node, scenario) selected and rendered in
      the detail pane — even when the feed's default kind filter would have hidden it: the feed widens its
      own kind chip to 'all' so the target row is visible and selected, never a silent fallback to the
      first row. A bogus address falls back to the first row and the hash canonicalizes to that row's real
      address. Zero loss = an eval is a pointable, shareable THING: the URL in the bar always names the
      eval on screen.
---
# measuring evals-view

YATU through the REAL running dashboard, never the code: the worktree dashboard pointed at a live backend,
a headless Chromium that opens #/evals and reads the live DOM (`.fv-master`, `.fv-list-col`, the
[[evals-feed]] rows, `.fv-detail`) + screenshots it. The loss is the gap between that reading and the
spec: a top-level Evals page (its own rail entry + route), a master-detail with the feed left and the
[[event-detail]] right, selection-is-detail, and the `f` / ⌥F doors landing here. This node owns the page
SHELL; the feed's rows and the detail's media are its children ([[evals-feed]], [[event-detail]]).
