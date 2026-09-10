---
title: node-diagram
status: active
hue: 30
desc: A node's diagram painted inline between its chip rows and its prose — archify's SVG and stylesheet, no viewer — where a click focuses a box and a double-click opens that child.
code:
  - spec-dashboard/src/NodeDiagram.jsx
related:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/styles.css
  - packages/archify/browser.mjs
  - packages/archify/assets/diagram.css
  - spec-dashboard/src/dependencyBoundary.test.mjs
---

# node-diagram

A node that carries a diagram ([[diagram]]) shows it on its page between the governed-file and attachment
rows and the prose, in the same pane the popup and the document share ([[spec-view]]). The backend has already
drawn it: the node's content carries the SVG, so the dashboard paints markup and ships no renderer.

**Inline, in archify's own box.** The SVG goes straight into the page inside a `.archify` box, styled by the
stylesheet archify generates from its viewer ([[archify]]). Every rule of that sheet is scoped under the box, so
it cannot reach the dashboard, and the dashboard's own rules for it are only the frame — border, radius — never
the diagram's palette. The palette follows the dashboard's `color-scheme`: a light theme gets archify's light
diagram and a dark theme its dark one, with no script watching the theme. The box keeps archify's default
detail level, `read`: fine labels wait for hover or focus.

**Each copy owns its ids.** A rendered SVG names its arrowheads and grid pattern with fixed ids, and a
`url(#…)` reference resolves to the first element in the document with that id. The dashboard keeps background
documents mounted, so a second copy of a diagram — a popup over a document, two tabs — would borrow the first
copy's markers, and a hidden first copy takes every arrowhead with it. Each mounted diagram therefore prefixes
its ids and their references with its own instance id before it is inserted.

**Two gestures.** A click on a box focuses it through archify's browser module: the box and its direct
neighbours stay lit, the rest dims, and every edge touching it carries a pulse flowing from source to target
until another click (on empty canvas: clear). Enter does the same for a box that has keyboard focus. A
double-click on a box whose id is one of this node's children opens that child's page; a box that is not a
child (a folded `others`, a non-node participant) is inert to it.

**A diagram that did not render is shown as text.** Its file, archify's message and each diagnostic, as plain
text in the slot the picture would take — never markup from the payload, and never a blank.

The dashboard takes from `@spexcode/archify` only its browser half — the stylesheet and the browser module —
and the dependency test fails if a dashboard source imports the renderer itself.
