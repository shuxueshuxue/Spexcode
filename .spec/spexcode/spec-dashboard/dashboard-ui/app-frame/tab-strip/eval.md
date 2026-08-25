---
scenarios:
  - name: page-kind-slot-regression
    description: >
      Open the running dashboard in a real browser. From a session document, use the Explorer to open the
      tab-strip spec and confirm the resident Spec tab focuses while the session remains; navigate from one
      spec to another and confirm the detail URL changes without minting a second Spec tab; click three
      session rows in the dock and confirm one
      session tab is reused; ctrl-click a session row and confirm it creates a pinned tab; open Settings and
      confirm its tab label is Settings.
    expected: >
      The strip contains both a session and one resident Spec tab after the cross-kind navigation. A second
      spec keeps the same `#/spec` tab identity while its detail address changes, and that tab face, tooltip,
      accessible label, and visible title use the selected node title. Three plain session clicks leave one
      session tab whose address is the last session. Ctrl-click adds a second non-slot session tab. The Settings tab reads
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
      the Sessions dock at both a 1440x900 desktop viewport and a 390x844 narrow viewport. Measure the rendered
      tab strip/content seam, an Explorer section divider, and a Sessions zone heading divider after each view
      settles; capture one screenshot per viewport.
    expected: >-
      The content host owns exactly one 1px top divider while the tab strip owns no bottom border. Explorer and
      Sessions group headings expose the same 1px divider rule, with no negative geometry, overlap, or horizontal
      overflow at either viewport. The tab strip bottom and content host top share one y coordinate.
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
    code: [spec-dashboard/src/SideBar.jsx, spec-dashboard/src/ReviewSurface.jsx, spec-dashboard/src/SettingsSurface.jsx, spec-dashboard/src/TabStrip.jsx]
    test: spec-dashboard/src/tabStrip.test.mjs
  - name: hold-gesture-on-every-row-surface
    description: >-
      In a real Chromium dashboard against the running backend, perform the strip's tab-minting whitelist on
      each row surface that lists an object a second tab can actually hold, and report how many kept it. Every
      probe first settles a workspace whose only same-kind tab is the replaceable slot, then acts on a
      DIFFERENT object: ctrl/cmd-click a governed-file row in the Explorer tree; ctrl/cmd-click and
      double-click a Sessions-page forest row; take the session row context menu's open-in-a-new-tab action;
      ctrl/cmd-click a session row in the search palette. Read the VISIBLE strip after each gesture and
      capture a screenshot of the settled workspace. Resident board addresses are deliberately out of the
      population: a spec, evals, issues, or settings detail canonicalizes to one top-level tab, so it has no
      second tab to mint.
    expected: >-
      All 5 probed surfaces keep the gesture: each one leaves exactly one more tab than before, the arriving
      tab carries the acted-on object's address, and it is held rather than the italic replaceable slot. The
      session row context menu offers an explicit open-in-a-new-tab item. The run reports the kept count over
      the probed count, and the browser console raises no product error.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionForestPanel.jsx, spec-dashboard/src/SessionContextMenu.jsx, spec-dashboard/src/SpecSearch.jsx]
    related: [spec-dashboard/src/tabs.js, spec-dashboard/src/SessionsView.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/Dock.jsx, spec-dashboard/src/FileTree.jsx, spec-dashboard/src/Shell.jsx]
    test: spec-dashboard/test/tab-hold-surfaces.e2e.mjs
  - name: hold-without-a-pointer
    description: >-
      In a real Chromium dashboard against the running backend, reach a session by ADDRESS so its tab is the
      replaceable slot, press the hold chord, and read the visible strip. Then open the help legend on the
      board that owns the key and read the row for that chord.
    expected: >-
      The chord holds the tab already showing: the same one tab remains, at the same address, no longer the
      italic slot — it neither mints a second tab nor changes which document is showing. The legend names the
      chord exactly once and prints it as the complete modifier glyph the registry holds, never a
      modifier-stripped key or a label with the shortcut typed into it. The browser console raises no
      product error.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/keymap.js]
    related: [spec-dashboard/src/tabs.js, spec-dashboard/src/Shell.jsx, spec-dashboard/src/Legend.jsx, spec-dashboard/src/bindings.js]
    test: spec-dashboard/test/tab-hold-chord.e2e.mjs
  - name: live-pointer-reorder-and-tail-drop
    description: >-
      In a real Chromium dashboard with three held document tabs, press and drag one tab across another and
      inspect the tab order before releasing; then drag a tab into the tab-list host's unoccupied right side
      and inspect the order before release and after a reload. Exercise a tab close click after the drags.
    expected: >-
      The order changes while the pointer is still held, not only on pointerup. The right-side blank host area
      appends the dragged tab without requiring a hit on the last tab. Release persists the same order through
      reload, the active route is unchanged, and the close click removes only its tab.
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/TabStrip.jsx, spec-dashboard/src/tabs.js, spec-dashboard/src/tabModel.js]
    test: spec-dashboard/test/tab-strip-drag.e2e.mjs
---

Measure YATU through the Vite dashboard in this worktree and a real browser against the running Spex backend.
Use screenshots of each settled end state as evidence for the static strip contents and labels.
