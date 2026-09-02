---
scenarios:
  - name: page-kind-slot-regression
    description: >
      Open the running dashboard in a real browser. From a session document, use the Explorer to open the
      tab-strip spec and confirm the resident Spec tab focuses while the session remains; navigate from one
      spec to another and confirm the detail URL changes without minting a second Spec tab; click three
      session rows in the dock and confirm one
      session tab is reused; ctrl-click a session row and confirm it adds a second session tab; open Settings and
      confirm its tab label is Settings.
    expected: >
      The strip contains both a session and one resident Spec tab after the cross-kind navigation. A second
      spec keeps the same `#/spec` tab identity while its detail address changes, and that tab face, tooltip,
      accessible label, and visible title use the selected node title. Three plain session clicks leave one
      session tab whose address is the last session. Ctrl-click adds a second session tab. The Settings tab reads
      Settings, never the internal key tabs.settings.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/tabModel.js, spec-dashboard/src/TabStrip.jsx]
  - name: spec-resident-detail-focus
    description: >-
      In a real Chromium dashboard, open two canonical `#/spec/<id>` detail URLs and inspect the workspace
      strip after each route settles; then open a `#/file/<path>` detail.
    expected: >-
      Both Spec details keep one active top-level Spec tab with the Spec icon. The URL retains each selected
      `#/spec/<id>` detail address, while its face, tooltip, accessible label, and visible title use that
      node's title. The file route keeps the resident Spec slot and opens an independent File tab named by
      its basename; it never mints a second Spec tab.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/views.jsx, spec-dashboard/src/tabModel.js, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/test/spec-resident-tab.e2e.mjs
  - name: divider-seam-and-group-head-geometry
    description: >-
      In a real Chromium dashboard, open a spec document with the Explorer dock and a session document with
      the Sessions dock (then ctrl/⌘-click a second live session so the document strip holds an inactive tab)
      at both a 1440x900 desktop viewport and a 390x844 narrow viewport. Measure the rendered tab strip/content
      seam — computed style and the actual pixels of the band's bottom row under the active tab, under an
      inactive tab, and in the empty band — an Explorer section divider, and a Sessions zone heading divider
      after each view settles; capture one screenshot per viewport and route.
    expected: >-
      The band meets the page at a hairline except under the active tab: the band's bottom row is the page's
      own colour under the active tab (joined, no line) and a divider under an inactive tab and in the empty
      band; the strip owns that rule as an inset at its bottom edge and the content host owns no top border, on
      the shell strip and on the session document's strip alike. Explorer and Sessions group headings expose
      the same 1px divider rule; Explorer adds no extra full-width border between its sections, with no negative
      geometry, overlap, or horizontal overflow at either viewport. The tab strip bottom and content host top
      share one y coordinate.
    tags: [frontend-e2e, desktop, mobile]
    code: [spec-dashboard/src/styles.css]
    test: spec-dashboard/test/divider-geometry.e2e.mjs
  - name: empty-workspace-after-last-session
    description: >-
      In a real Chromium dashboard, boot without a hash, seed one real session object into the persisted
      working set, open its session document, and close its visible tab. Then navigate to an unknown hash.
      Inspect the live rail, URL, visible view classes, and settled empty-state controls at 1440x900.
    expected: >-
      A cold boot lands on `#/sessions`. The live rail has no graph anchor. Closing the last session tab
      lands on `#/empty`, leaves zero tabs, renders the real EmptyView with Search and Explorer doors, and
      does not revive graph. An unknown hash normalizes to `#/sessions` and still has no live graph rail entry.
      The browser console has no product errors; the Vite-only fixture's optional catalog 404 is ignored.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/EmptyView.jsx, spec-dashboard/src/SideBar.jsx, spec-dashboard/src/route.js, spec-dashboard/src/tabModel.js, spec-dashboard/src/views.jsx]
    test: spec-dashboard/test/empty-workspace.e2e.mjs
  - name: review-route-icons-have-one-owner
    description: >-
      In a real Chromium dashboard, open the Evals, Issues, and Settings routes from cold URLs and inspect
      the route rail and workspace strip. Count the active rail entry's SVG and any workspace tabs on each
      route after the surface settles.
    expected: >-
      Each route has exactly one active rail entry with its shared page icon; review/settings surfaces do not
      mint a workspace tab merely to carry an icon. Board-local filter tabs, when present, remain view-local
      controls and do not become route tabs.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/Shell.jsx, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/src/tabStrip.test.mjs
  - name: new-tab-gesture-on-every-row-surface
    description: >-
      In a real Chromium dashboard against the running backend, perform the strip's new-tab gesture on each
      row surface that lists an object a second tab can actually hold, and report how many kept it. Every
      probe first settles a workspace whose only same-kind tab is the focused session tab, then acts on a
      DIFFERENT object: ctrl/cmd-click a session row in the finding dock; ctrl/cmd-click a Sessions-page forest
      row; take the session row context menu's open-in-a-new-tab action; ctrl/cmd-click a session row in the
      search palette. Read the VISIBLE strip after each gesture, then plain-click a third session row while
      the arrived tab is focused, and read the strip again. Capture a screenshot of the settled workspace.
      Resident board addresses are deliberately out of the population: a spec, evals, issues, or settings
      detail canonicalizes to one top-level tab, so it has no second tab to mint.
    expected: >-
      All 4 probed surfaces keep the gesture: each one leaves exactly one more tab than before, and the
      arriving tab carries the acted-on object's address. The tab that arrived is an ordinary tab: the
      following plain click replaces it and the count does not move. No tab is drawn as a replaceable-slot
      face, because none exists. The session row context menu offers an explicit open-in-a-new-tab item.
      The run reports the kept count over the probed count, and the browser console raises no product error.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionForestPanel.jsx, spec-dashboard/src/SessionContextMenu.jsx, spec-dashboard/src/SpecSearch.jsx]
    related: [spec-dashboard/src/tabs.js, spec-dashboard/src/SessionsView.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/Dock.jsx, spec-dashboard/src/FileTree.jsx, spec-dashboard/src/Shell.jsx]
    test: spec-dashboard/test/tab-new-tab-surfaces.e2e.mjs
  - name: live-pointer-reorder-and-tail-drop
    description: >-
      In a real Chromium dashboard with three open document tabs, press and drag one tab across another and
      inspect the tab order before releasing; then drag a tab into the tab-list host's unoccupied right side
      and inspect the order before release and after a reload. Exercise a tab close click after the drags.
    expected: >-
      The order changes while the pointer is still held, not only on pointerup. The right-side blank host area
      appends the dragged tab without requiring a hit on the last tab. Release persists the same order through
      reload, the active route is unchanged, and the close click removes only its tab.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TabStrip.jsx, spec-dashboard/src/tabs.js, spec-dashboard/src/tabModel.js]
    test: spec-dashboard/test/tab-strip-drag.e2e.mjs
  - name: close-returns-to-last-focused-tab
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop Chromium against the running dashboard. Scene A: open `#/spec`, `#/evals`,
      `#/issues`, then `#/spec`, then `#/evals`, and close the active Evals tab through its visible
      `.tab-x`; read `location.hash`. Scene B (fresh storage): open `#/file/README.md`, then `#/spec/<node>`,
      then `#/file/CLAUDE.md` (a file opened while Spec is focused is appended, not a replacement), then
      `#/spec/<node>` and `#/file/package.json` likewise, so three file tabs and the Spec tab coexist; then
      refocus `#/file/README.md`, `#/spec/<node>`, and `#/file/package.json` in that order, and close the
      active package.json tab; read `location.hash`.
    expected: >-
      Scene A lands on `#/spec` — the tab the reader was on before Evals — not on Issues, the positional
      neighbour. Scene B lands on `#/spec/<node>`: the most recently focused surviving tab across kinds wins
      over the nearer file (CLAUDE.md) and the file's unrelated neighbour. Only the closed tab leaves the
      strip. Zero loss = closing returns the reader to the tab they actually came from.
    code: [spec-dashboard/src/tabModel.js, spec-dashboard/src/tabs.js]
    test: spec-dashboard/test/tab-close-focus-history.e2e.mjs
  - name: inactive-tab-survives-navigation-and-creation
    tags: [frontend-e2e, desktop]
    description: >-
      In a real desktop Chromium against an isolated backend whose launcher exits at once, seed four sessions
      and reach A by address so its tab is the only session tab. Scene 1: ctrl/⌘-click B (appended, focused),
      then plain-click D's row. Scene 2: with D focused, plain-click E's row. Scene 3: open New Session, type a
      prompt, press Enter, and wait for the route to reach the published session. Scene 4: with the created
      session focused, plain-click B's row. Read the VISIBLE strip after each scene settles, capture one
      screenshot per scene, and record the run with its step ruler.
    expected: >-
      4 of 4 scenes keep the balance. Scene 1: A survives inactive; the appended B is the focused tab, so D
      replaces B and the count does not move. Scene 2: E replaces D and the count does not move — the focused
      same-kind tab is the only one a plain click may overwrite. Scene 3: the created session arrives focused
      beside A and E (one more tab), the route reaches `#/sessions/<id>`, and nothing is evicted. Scene 4: the
      created tab is an ordinary tab — B replaces it and the count does not move. No tab carries a
      replaceable-slot face at any point, and the browser raises no product error or unhandled rejection.
    code: [spec-dashboard/src/tabModel.js, spec-dashboard/src/tabs.js]
    related: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/test/tab-inactive-survives.e2e.mjs
  - name: meta-w-closes-active-tab
    description: >-
      In the real Electron shell from the desktop spike (`npm run desktop:install &&
      SPEXCODE_DESKTOP_CWD=<a project> npm run desktop:start`), open at least two document tabs and drive the
      window through Playwright Electron support or CDP. Send Meta+W to the focused shell window, then inspect
      the active route and visible tab strip.
    expected: >-
      Meta+W closes exactly the active tab, the tab leaves the strip, and the active route is the deterministic
      closeDestination result. No browser-only shortcut handling or Electron detection branch is present in
      the SPA.
    tags: [desktop, frontend-e2e]
    code: [spec-dashboard/src/keymap.js, spec-dashboard/src/Shell.jsx, spec-dashboard/src/tabs.js]
  - name: meta-digit-focuses-tab
    description: >-
      In the same real Electron shell, open at least three document tabs and send Meta+Digit1, Meta+Digit2,
      and Meta+Digit9 through the shell window, reading the active tab after each event.
    expected: >-
      Meta+Digit1 and Meta+Digit2 focus the first and second tabs; Meta+Digit9 focuses the last tab (the
      Obsidian/browser convention). Ctrl+Digit1..9 are equivalent. The legend and Settings render every
      declared chord with ⌘/⌃ glyphs derived from MOD_GLYPH.
    tags: [desktop, frontend-e2e]
    code: [spec-dashboard/src/keymap.js, spec-dashboard/src/KeyboardService.jsx, spec-dashboard/src/Legend.jsx, spec-dashboard/src/Settings.jsx]
  - name: tear-off-opens-window
    description: >-
      In a real headless browser against the running dashboard, open two document tabs and drag one tab beyond
      the viewport so the release has no in-strip drop target. Observe popup creation and inspect its URL and
      the original strip after the drag settles.
    expected: >-
      One popup opens at the dragged tab's full scoped address, including `/p/<id>/` when scoped, and the
      dragged tab leaves the original strip through the normal close path. No cross-window tab state sync is
      attempted; both pages continue to use the same backend.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/TabStrip.jsx, spec-dashboard/src/tabs.js, spec-dashboard/src/route.js]
---

Measure YATU through the Vite dashboard in this worktree and a real browser against the running Spex backend.
Use screenshots of each settled end state as evidence for the static strip contents and labels.
