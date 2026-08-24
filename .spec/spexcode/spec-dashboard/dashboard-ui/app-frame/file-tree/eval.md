---
scenarios:
  - name: explorer-graph-entry-opens-spec-route
    description: >-
      In a running desktop dashboard, open #/spec with the Explorer dock and activate its fixed Spec graph
      entry below the Specs and Files disclosures. Inspect the settled route and entry geometry.
    expected: >-
      The Explorer renders one fixed Spec graph entry beneath the Specs/Files sections. Activating it keeps
      the canonical #/spec route focused, without creating a second tab or a transient overlay.
    tags: [frontend-e2e, desktop]
    code:
      - spec-dashboard/src/FileTree.jsx
      - spec-dashboard/src/Shell.jsx
      - spec-dashboard/src/styles.css
---

Measure through the running dashboard in a real desktop browser (YATU). Capture the settled Explorer
and record the route before and after activating the graph entry, plus its bounding rectangle.
