---
scenarios:
  - name: page-kind-slot-regression
    description: >
      Open the running dashboard in a real browser. From a session document, use the Explorer to open the
      tab-strip spec and confirm both documents remain; navigate from one spec to another and confirm the
      spec slot is replaced while the session remains; click three session rows in the dock and confirm one
      session tab is reused; ctrl-click a session row and confirm it creates a pinned tab; open Settings and
      confirm its tab label is Settings.
    expected: >
      The strip contains both a session and the opened spec after the cross-kind navigation. A second spec
      replaces the first spec in its same-kind slot. Three plain session clicks leave one session tab whose
      address is the last session. Ctrl-click adds a second non-slot session tab. The Settings tab reads
      Settings, never the internal key tabs.settings.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/tabModel.js, spec-dashboard/src/TabStrip.jsx]
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
---

Measure YATU through the Vite dashboard in this worktree and a real browser against the running Spex backend.
Use screenshots of each settled end state as evidence for the static strip contents and labels.
