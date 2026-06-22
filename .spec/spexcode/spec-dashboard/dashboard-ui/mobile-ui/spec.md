---
title: mobile-ui
status: active
session: e335f3af-0695-488c-b12e-5fd1299e8b6a
hue: 210
desc: The phone-sized face of the board — a touch drill-down of the spec tree plus a sessions tab, reusing the same polled data and the same node panes, because the desktop graph's pan/zoom/keyboard model can't be driven by a thumb.
code:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/useIsMobile.js
  - spec-dashboard/src/styles.css
---
# mobile-ui

The desktop board is a zoomable canvas walked with vim keys, chords, and hover popovers —
instruments a phone has no pointer or keyboard for. So a narrow viewport gets a separate,
touch-first face rather than a squeezed graph. The choice is viewport width alone (a media
query, reactive so a rotate or resize flips it with no reload); both faces read the one polled
board, so nothing about the data or the backend forks.

The phone keeps the same two planes the desktop shows, made native to touch:

- **Specs** — the graph becomes a drill-down. A breadcrumb names where you are; tapping a row
  descends into that node. Each node screen is a compact header over the SAME reading panes the
  desktop popup renders (spec, history, issues, edit) — there is no second markdown or diff
  renderer. A branch opens to its children first; a leaf opens to its spec.
- **Sessions** — the live workers, drawn with the same session face as every other surface.
  Opening one shows its status, its rolling activity, and the nodes it is changing; tapping a
  changed node crosses back into Specs focused there.

It is **read-first**: it answers "what does the tree say" and "what are my agents doing" from a
phone. Authoring work and streaming a session's live console (terminal sizing and text input on
a phone are their own problem) stay with the desktop board — a deliberate scope line, not an
oversight.
