---
scenarios:
  - name: evals-list-page
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/ReviewShell.jsx]
    description: >
      Open the dashboard in a real browser at a live backend. Click the Evals rail entry (or press ⌥3 / f
      from the graph) and read location.hash + the rendered page. Read the list page's DOM: the row
      elements' tag name and href attributes, the sticky head's controls (kind dropdown, session scope
      picker), and the chip row. Change the kind filter and read the hash; reload the browser at that
      filtered address and read the active filter back from the DOM.
    expected: >
      The hash reads #/evals and the Evals rail entry is accented. The page is a GitHub-style full-width
      LIST — one row per (node, scenario), each row a REAL <a> anchor whose href is that eval's canonical
      detail address (#/evals/<node>/<scenario>), copyable/middle-clickable; NO master-detail split pane
      and NO in-page detail. The head carries the shared kind dropdown (video | image | all) and the
      session scope picker (default off = merged). A filter pick REWRITES the address (e.g.
      #/evals?kind=all) as a history push, and a fresh reload at that filtered address re-derives the
      exact same filter state from the URL — the address IS the list state. Zero loss = the list is one
      page whose whole state lives in its URL and whose rows are links.
  - name: list-detail-push-back
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/EventDetail.jsx]
    description: >
      In a real browser on #/evals with a non-default filter applied (e.g. ?kind=all): record
      history.length, click a row's anchor, and read the new hash + history.length + the rendered page.
      Then drive the browser's real Back and read the hash + the restored list DOM. Also reload the
      browser directly at the detail address and read what renders.
    expected: >
      Clicking a row PUSHES (history.length grows by one — the GitHub-measured semantics) and lands on
      #/evals/<node>/<scenario> as a STANDALONE full page: header (scenario title + node), status band
      (verdict badge, A/B strip when history exists), the evidence workspace as the MAIN column, the
      reading metadata (evaluator, time, filer liveness, staleness) in the SIDE rail, the remark thread +
      docked composer below the workspace. NO fake in-app back button. Browser Back restores EXACTLY the
      previous list URL — filters intact — and the list re-renders that state. A direct reload at the
      detail address renders the same standalone page with no list mounted first. An address naming no
      real eval renders the honest not-found face with a link back to #/evals — never a silent rewrite.
      Zero loss = list→detail is a real navigation, Back is the browser's, and every page is directly
      openable.
  - name: session-scope-and-legacy-redirect
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/SessionInterface.jsx]
    description: >
      With a live session that has worktree-rooted readings: on #/evals open the session scope picker and
      pick that session; read the hash, the gates strip, and the rows. Then open the legacy address
      #/sessions/<id>/eval directly and read the hash after settle. Open the session console and click
      the Eval entry; read where it lands. Finally check a session-scoped row's href carries the scope.
    expected: >
      Picking a session rewrites the address to #/evals?session=<id> and the list becomes that session's
      WORKTREE-rooted model: the gates strip (the review numbers + the HTML export door) above, blind
      spots leading as inert unmeasured rows, the session's own readings ✦-marked, then the inherited
      baseline. Row hrefs carry ?session=<id> so the detail's A/B history walks the worktree readings.
      The legacy #/sessions/<id>/eval address NORMALIZES (replace) to #/evals?session=<id> — old links
      keep working, the old shape never shows in the bar. The console's Eval entry is a DOOR that
      navigates to the same session-scoped list (no in-console eval pane exists). Zero loss = un-merged
      worktree evals live in the ONE #/evals route family behind a default-off session filter.
  - name: session-detail-refresh-stability
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >
      Open a session-scoped detail whose scenario has at least two readings and a timeline sidecar. Walk
      from the latest B pole to the older A pole, wait for the timeline events to render, and type an
      unsent composer draft. Trigger an app board refresh (the same new specs/sessions props a poll or SSE
      board message delivers) without changing the session model, node, or scenario; record the whole flow.
    expected: >
      The board repaint does not change the selected A/B pole or position label, the timeline/step events
      remain rendered, and the exact unsent draft remains in the composer. No session-model refetch occurs.
      Changing the addressed scenario still resets those working states. Zero loss = unrelated app
      freshness cannot erase review work in progress.
  - name: session-scope-load-failure
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/ReviewShell.jsx]
    description: >
      Open a session-scoped Evals list and detail while forcing its `/api/sessions/:id/evals` request to
      return 503, then repeat with a real 404/missing target. Read the visible controls, alert/not-found
      faces, and retry by changing the scope picker.
    expected: >
      A transport/5xx failure is explicit: the list retains the session scope and kind controls and shows
      a load-failed alert, while the detail shows the distinct load-failed face. It never says the session
      has no evals and never renders the addressed eval as not-found. A genuine missing session/reading uses
      the normal empty/not-found copy instead, and the list's scope picker remains usable in every state.
  - name: mobile-evals-pages
    tags: [frontend-e2e, mobile]
    code: [spec-dashboard/src/MobileApp.jsx, spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/styles.css]
    description: >
      In a real browser at a 390px viewport: open #/evals (via the tab bar's Evals entry or directly),
      read the list; open a row's detail and read the column order of the rendered page (side metadata
      vs the evidence workspace); drive browser Back. Compare the DOM classes against the desktop pages.
    expected: >
      The phone renders the SAME routed pages (the lp-/ds- chrome, not a mobile clone) inside the phone
      shell, with an Evals entry on the tab bar. The detail reflows to ONE column with the side metadata
      ABOVE the evidence workspace (GitHub's 390px order), never a shrunken two-column; the composer
      stays reachable at the column's foot. Back returns to the list with its state. Zero loss = one
      component set, two viewports, same URLs.
---
# measuring evals-view

YATU through the REAL running dashboard, never the code: the worktree dashboard pointed at a live backend,
a headless Chromium that opens the #/evals pages and reads the live DOM (`.lp-page`, `.lp-row` anchors,
`.ds-page`, `.ds-side`) + screenshots them. The loss is the gap between that reading and the GitHub-style
two-page contract: list state in the URL, rows as real links, push on open, Back restoring the filtered
list, standalone detail pages, and the session scope carrying the un-merged worktree evals.
