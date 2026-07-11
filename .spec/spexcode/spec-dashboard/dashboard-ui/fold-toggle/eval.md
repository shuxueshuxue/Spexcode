---
scenarios:
  - name: obsidian-toggle-icon
    description: >
      Open the running dashboard in a real browser. On #/evals and #/issues, the master-list fold
      control (top-right of the left column, .fv-fold) must render the shared Obsidian-style
      sidebar-toggle SVG icon (outlined rounded panel + filled inner bar), not a text arrow. Click it:
      the column folds to a thin strip whose unfold affordance (.fv-unfold) shows the SAME icon near the
      strip's top. The buttons keep their masterList.fold/unfold title/aria-label.
    expected: >
      Both pages show the icon button (an svg.fold-toggle-icon inside the button, no ‹/› text), fold and
      unfold use the identical glyph, and folding/unfolding still works — screenshot evidence shows the
      icon in both states.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/FoldToggle.jsx]
---

Measure YATU: run the dashboard (vite + a backend when list data is needed), drive headless Chromium to
the real pages, read the DOM (the button must contain `svg.fold-toggle-icon`) and screenshot the rendered
button in both unfolded and folded states.
