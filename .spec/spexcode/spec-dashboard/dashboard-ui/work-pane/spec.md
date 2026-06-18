---
title: work-pane
status: active
session: sess-merge
hue: 335
desc: Spec and terminal are one surface — intent (left) beside the live session (right).
code:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/styles.css
---
# work-pane

The spec and the terminal are one act split in two — the spec is the *intent*, the
terminal is where you *change it in place* — so they share one `work` pane, two
columns: spec left (reference, read), terminal right (the work surface that needs the
rows/cols). The split is 40/60 so the spec stays readable while the terminal keeps the
larger share. Tabs are **work / recent / history**; the terminal owns the keyboard
while the pane is open, Tab cycles panes, Esc returns to the graph.

The panel is a fixed-size pop-out (`min(900px,90vw) × min(600px,84vh)`). `min-width:0`
runs down the flex chain (`.ov-body` → `.pane-work` → `.pane-doc`/`.pane-term` →
`.term-host`) so the columns shrink to the panel instead of growing to xterm's measured
width; the body is `overflow:hidden` and never scrolls itself — each pane scrolls its
own content and the terminal clips to its host. No stray horizontal scrollbar.
