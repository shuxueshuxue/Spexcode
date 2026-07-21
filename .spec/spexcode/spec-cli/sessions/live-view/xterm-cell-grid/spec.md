---
title: xterm-cell-grid
status: active
hue: 280
desc: The pinned DOM renderer boxes every glyph run by terminal cells, so font fallback and DPR rounding cannot push the final columns outside the grid.
code:
  - spec-dashboard/scripts/patch-xterm-sync-resize.mjs
related:
  - spec-dashboard/package.json
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/styles.test.mjs
---

# xterm-cell-grid

The browser terminal is a cell grid, so renderer geometry comes from cells rather than an accumulated font
measurement estimate. The pinned xterm DOM renderer measures glyphs to choose their internal letter spacing,
but every emitted span also owns an explicit width equal to the cells represented by that span and clips ink
to that box. A machine-specific CJK fallback face, font load, browser snap, or device-pixel ratio can therefore
change ink inside a cell without shifting later cells or pushing the final glyphs through the row's right edge.
Selection rebuilds the DOM rows through the same factory, so selected foreground spans retain those exact boxes;
dragging cannot change glyph advance, hide the first selected cell, or perturb row layout.

The same version-locked, exact, idempotent installer used by [[xterm-sync-resize]] applies this upstream-sized
correction. An unexpected xterm version or source shape fails installation. SpexCode does not reserve a guessed
pixel gutter, remove a useful column, switch renderers by visibility, or patch glyphs by application or script.
[[live-view]] owns the tmux/browser grid transaction and its real-browser evidence; this node owns the DOM
renderer cell-box invariant.
