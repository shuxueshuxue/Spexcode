---
scenarios:
  - name: shared-icon-buttons
    description: >
      Open the running dashboard in a real browser. The converted icon buttons must render real stroke
      SVGs from the shared icons.jsx vocabulary, each keeping its tooltip/accessible name: the issues
      page New button (.fv-new-btn) is a ＋ plus icon with title/aria-label "New"; the session console's
      New pill (.si-pill.new) and search pill draw the plus/magnifier from the same set; a modal's close
      control (.legend-close) is an × icon with the close label; the annotator's A/B walkers (.an-ab-nav)
      are chevron icons and its play control (.an-play) a play/pause icon; the side rail still shows its
      five page glyphs via <Icon>.
    expected: >
      Screenshots show each converted control rendering its SVG glyph (no unicode text ＋ × ⏸ ▶ ‹ › in
      the buttons), and DOM reads confirm every icon-only button carries both title and aria-label.
    tags: [frontend-e2e]
    code: [spec-dashboard/src/icons.jsx]
---

Measure YATU: run the worktree dashboard (vite; symlink node_modules first) against a spex backend,
drive headless Chromium to #/issues, #/sessions and a modal, read each button's innerHTML (must contain
`<svg`), its `title` and `aria-label`, and screenshot the rendered controls.
