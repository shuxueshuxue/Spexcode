---
scenarios:
  - name: route-selected-title-and-brand
    tags: [frontend-e2e, desktop]
    description: >-
      Through an isolated real gateway with two differently titled projects, load `/projects` and both
      `/p/<id>/#/graph` URLs. Read `document.title`, the global Projects heading/brand, and each scoped graph
      HUD/rail label after catalog and board settle; deliberately make one backend board report the other
      project's title as a negative control.
    expected: >-
      The global tab is `Projects · SpexCode`. Each scoped tab, HUD, rail mark label, and switcher row use
      the matching URL/catalog identity. A wrong or last-loaded board cannot rename a scoped catalog route;
      a catalog-denied direct-project guest uses only its authorized board identity and sees no fleet.
    code: spec-dashboard/index.html
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/SideBar.jsx
      - spec-dashboard/src/Dashboard.jsx
---
# tab-title loss

Measure the actual browser title and rendered identity surfaces through `/projects` and `/p/<id>/`, not a
helper or an unscoped dev shortcut.
