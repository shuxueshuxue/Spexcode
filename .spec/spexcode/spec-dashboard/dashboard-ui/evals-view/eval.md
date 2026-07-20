---
scenarios:
  - name: evals-list-page
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/ReviewShell.jsx]
    description: >
      Open the dashboard in a real browser at a live backend. Click the Evals rail entry (or press ⌥3 / f
      from the graph) and read location.hash + the rendered page. Read the list page's DOM: the row
      elements' tag/href and structured content, 32px query with its visible token text, Current/Reviewed
      sections, direct menus, and overflow. Edit the query, pick verdict/evidence values, and add a
      scope: token; read the hash, reload, and Back through the prior states.
    expected: >
      The hash reads #/evals, the Evals rail entry is accented, and the input shows the default
      `is:eval state:current`. The page is a GitHub-style full-width
      ListView — one structured row per (node, scenario), each row a REAL <a> anchor whose href is that eval's canonical
      detail address (#/evals/<node>/<scenario>), copyable/middle-clickable; NO master-detail split pane
      and NO in-page detail. Current/Reviewed + counts sit left; verdict/freshness/evidence keep
      low-cardinality menus while node/filer/scope are query tokens only. A query, section, or menu pick
      writes the ONE canonical address (e.g. #/evals?q=is:eval state:current verdict:fail) as a history
      push with the pick visible in the input text, and reload/Back re-derive the exact state.
      The list/detail/A-B verdict icon, label, and tone come from ONE `.review-state` mapping. Zero loss = one
      page whose whole state lives in its URL and whose rows are links.
  - name: list-detail-push-back
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/EventDetail.jsx]
    description: >
      In a real browser on #/evals with a non-default filter applied (e.g. ?q=is:eval state:current
      verdict:fail): record
      history.length, click a row's anchor, and read the new hash + history.length + the rendered page.
      Then drive the browser's real Back and read the hash + the restored list DOM. Also reload the
      browser directly at the detail address and read what renders.
    expected: >
      Clicking a row PUSHES (history.length grows by one — the GitHub-measured semantics) and lands on
      #/evals/<node>/<scenario> as a STANDALONE full page: header (scenario title + node), status band
      (verdict badge, A/B strip when history exists), the evidence workspace as the MAIN column, the
      reading metadata (evaluator, time, filer liveness, staleness) in the SIDE rail, the remark thread +
      docked composer below the workspace. The header leads with the compact back ANCHOR — a real
      `<a href="#/evals">` (arrow glyph, localized tooltip + aria-label), never a history.back button —
      and Enter on the focused anchor follows it. Browser Back still restores EXACTLY the
      previous list URL — filters intact — and the list re-renders that state. A direct reload at the
      detail address renders the same standalone page (same back-anchor href) with no list mounted first.
      An address naming no
      real eval renders the honest not-found face with a link back to #/evals — never a silent rewrite.
      Zero loss = list→detail is a real navigation, Back is the browser's, and every page is directly
      openable.
  - name: detail-back-anchor-destinations
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/address.js]
    description: >
      Open a trunk eval detail (#/evals/<node>/<scenario>) by row click, by direct URL, and by reload —
      read the back anchor's href each time. Then open a session-scoped detail
      (#/evals/<node>/<scenario>?q=scope:<id>) the same three ways: re-read the back href, and read the
      top of the page for a source banner — its role, its text, whether its session link is a real
      anchor and where it points; click both the back anchor and the banner link and read where each
      lands. Compare against an issues detail's anchor. Verify browser Back after clicking the anchor
      still walks the real history.
    expected: >
      EVERY eval detail's back anchor is href="#/evals" — trunk and scoped alike; the scope token never
      diverts the back arrow. An issue detail's anchor is #/issues. The SCOPED detail wears one
      restrained source banner above the header: it names the session/worktree the reading comes from
      and carries a REAL <a href="#/sessions/<id>"> to the terminal console — the one explicit session
      door; clicking it lands on that session. A trunk detail wears no banner. Row-click, direct open,
      and reload yield byte-identical back hrefs AND banner faces (no referrer/history/presence
      guessing). The anchor is an ordinary push: after following it, browser Back returns to the detail,
      and Back again to wherever the visit actually began.
  - name: continue-reviewing-queue
    tags: [frontend-e2e, desktop, mobile]
    description: >
      Open a trunk eval detail from the middle of the #/evals list at 1440px and read the side rail below
      the metadata sections: the continue-reviewing section's group headings and rows — which group each
      neighbor sits in and its order against the source dataset's stable list order (the default list
      FACE may hide reviewed rows the queue still walks), whether each is a real anchor with the shared
      verdict icon plus scenario and node text, and whether the current reading appears. Open the FIRST
      and the LAST list entries' details and re-read groups and counts. Follow a queue anchor by click
      and by keyboard focus+Enter, then press browser Back. Open a session-scoped detail and read the
      queue hrefs. Resize to 390px and read the column order and document scroll width. Find a dataset
      with a single scenario (or a scoped session with one reading) and read whether the section renders.
    expected: >
      The queue renders as TWO groups under the one continue-reviewing section — Previous, then Up next —
      strictly POSITIONAL against the source dataset's stable list order (the list page's order; the
      labels claim list direction, never time): Previous holds entries BEFORE the current row, Up next
      entries AFTER it, each group ordered nearest-to-current first, the current reading excluded. The
      default total stays ~5, split balanced across the groups (the forward group takes the odd slot);
      at either boundary the short side's unused budget refills from the other side so the total holds
      while the dataset allows. A group with no entries renders NO heading; with no neighbor at all the
      whole section is absent — no empty box, no label. Each row is a REAL <a> to the neighbor's
      canonical detail wearing the ONE shared ReviewState visual + scenario + node — no checkbox, no
      page-local selection state, no second filter UI. A trunk neighbor's href is the pure detail path;
      a scoped neighbor's carries the same one scope: token. Click and focus+Enter both navigate
      (ordinary push — Back returns to the detail just left). At 390px the same rail reflows above the
      main column with no horizontal overflow. With no neighbor the section is entirely absent
      — no empty box, no label.
  - name: session-scope-and-legacy-redirect
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/route.js, spec-dashboard/src/SessionInterface.jsx]
    description: >
      With a live session that has worktree-rooted readings: on #/evals scope to that session through the
      query — type scope: and pick it from the bounded suggestions (board sessions only) — and read the
      hash, the gates strip, and the rows. Then open the legacy address
      #/sessions/<id>/eval directly and read the hash after settle. Open the session console and click
      the Eval entry; read where it lands. Finally check a session-scoped row's href carries the scope.
    expected: >
      Scoping rewrites the address to the scoped LIST query (#/evals?q=is:eval state:current scope:<id> —
      the same text every session door mints) and the list becomes that session's
      WORKTREE-rooted model: the gates strip (the review numbers + the HTML export door) above, blind
      spots leading as inert unmeasured rows, the session's own readings ✦-marked, then the inherited
      baseline. Row hrefs carry ?q=scope:<id> ALONE — a detail address never drags list filters — so the
      detail's A/B history walks the worktree readings, and the detail's way back to the list is the
      scoped default query again. The legacy #/sessions/<id>/eval address NORMALIZES (replace) to the
      scoped default list — old links keep working, the old shape never shows in the bar. The console's
      Eval entry is a DOOR that
      navigates to the same session-scoped list (no in-console eval pane exists). Zero loss = un-merged
      worktree evals live in the ONE #/evals route family behind the scope: token.
  - name: session-detail-refresh-stability
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/EventDetail.jsx]
    description: >
      Open a session-scoped detail whose scenario has at least two readings and a timeline sidecar. Walk
      from the latest B pole to the older A pole, wait for the timeline events to render, type unsent prose,
      and stamp an anchor while keeping that prose. Trigger an app board refresh (the same new specs/sessions
      props a poll or SSE board message delivers) without changing the scope, node, scenario, or viewed
      reading. Then flip to the other A/B reading, type again, and switch between session and merged scope;
      confirm each clears. Finally, on scenario A create another ordinary + anchored draft, navigate to a
      different scenario B under the same scope and confirm it opens empty, then return to A and confirm the
      old draft does not revive. Record the whole flow.
    expected: >
      The board repaint does not change the selected A/B pole or position label, the timeline/step events
      remain rendered, and the exact ordinary prose + anchored prefill remain in the composer. No
      session-model refetch occurs. A real A/B-reading, scope, or addressed-scenario change clears both
      ordinary and anchored drafts before the new evidence is reviewable; scenario A→B opens B empty and
      returning B→A does not restore A's discarded draft. Zero loss = unrelated app freshness cannot erase
      review work, while review text cannot leak across or revive after a real evidence identity change.
  - name: session-scope-load-failure
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EvalsPage.jsx, spec-dashboard/src/ReviewShell.jsx]
    description: >
      Open a session-scoped Evals list and detail while forcing its `/api/sessions/:id/evals` request to
      return 503, then repeat with a real 404/missing target. Read the visible controls, alert/not-found
      faces, and retry by changing the Scope facet.
    expected: >
      A transport/5xx failure is explicit: the list retains the ListView query/facet chrome and shows
      a load-failed alert, while the detail shows the distinct load-failed face. It never says the session
      has no evals and never renders the addressed eval as not-found. A genuine missing session/reading uses
      the normal empty/not-found copy instead, and the list's Scope facet remains usable in every state.
  - name: mobile-evals-pages
    tags: [frontend-e2e, mobile]
    code: [spec-dashboard/src/MobileApp.jsx, spec-dashboard/src/ReviewShell.jsx, spec-dashboard/src/styles.css]
    description: >
      In a real browser at a 390px viewport: open #/evals (via the tab bar's Evals entry or directly),
      read query/header/row sizes, visible facets and the opened kebab, body/document scroll width; open a
      long row's detail and read the column order (side metadata vs workspace); drive browser Back.
    expected: >
      The phone renders the SAME routed pages (the lp-/ds- chrome, not a mobile clone) inside the phone
      shell, with an Evals entry on the tab bar. Query is viewport minus 32px, metadata ~49px; only Verdict
      remains direct and all displaced real facets are functional in kebab. Long titles and metadata wrap
      inside the row and body/document equal 390px. The detail reflows to ONE column with side metadata
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
