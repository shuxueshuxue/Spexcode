---
title: drag-gesture
status: active
hue: 205
desc: One pointer gesture for every movable list in the window — the threshold, the swallowed click, the cancel, and the cleanup, written once.
code:
  - spec-dashboard/src/dragGesture.js
related:
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/styles.css
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/tab-strip/spec.md
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/dock-modes/spec.md
---
# drag-gesture

Two surfaces in this window let the reader MOVE something with the pointer: the tab strip reorders its
documents ([[tab-strip]]) and the session dock moves sessions between parents, out to the top level, or
through the archive door ([[dock-modes]]). What they move and where it may land is entirely different. How
the pointer behaves on the way there must not be.

**Moving something is not one behaviour, it is five, and each has its own way of being got wrong.**

- **A press that was meant as a click stays a click.** Nothing at all happens until the pointer has
  travelled six pixels; below that the gesture never begins, so click, double-click, middle-click and the
  context menu are untouched on rows that are movable. Six is the number the retired session list used and
  the number this replaces it with: small enough that a deliberate drag feels immediate, large enough that
  a click delivered by a hand that shifted a pixel is still a click.
- **A drag eats its own click.** A moved button still dispatches `click` on release, and that click would
  run whatever the row does when clicked — navigating away from the thing just dropped. One capturing
  listener swallows exactly one click and lives for a single turn, so browsers that suppress it themselves
  simply never hand one over, and ordinary clicks are untouched from the next turn onward. This is the
  gesture's own job rather than the caller's: a per-caller suppression flag is a piece of shared state that
  drifts, and it drifted before.
- **The listeners are on the WINDOW.** A pointer leaves the row it started on immediately — that is the
  whole point of dragging — so a listener bound to the row would lose the gesture on the first movement. When
  the caller receives a PointerEvent, the pressed element captures that pointer for the gesture. The window
  listeners remain the shared dispatch point, while capture keeps move and release delivery alive after the
  pointer leaves the viewport; mouse-event callers retain the same window-listener fallback.
- **Escape abandons it**, applying nothing.
- **Unmount abandons it too.** Starting a gesture returns the abandon call, so a component that disappears
  mid-drag leaves nothing on the window and no stuck cursor.

**It is deliberately not native HTML5 drag-and-drop.** That API brings a drop-target protocol, a transfer
payload and a browser-drawn ghost, none of which either caller wants, and its `dragstart` is swallowed by
the interactive elements both lists are built from — a row here IS a button. Pointer/mouse events on the
window are the smaller mechanism and they are the one the retired list proved out.

**The window wears the gesture.** One body class carries the grabbing cursor and the text-selection ban for
every caller, so a drag reads the same whether it began in the strip or in the dock. Each caller still owns
its own *meaning*: what a landing place is, what the drop does, and how the landing is marked. The gesture
knows nothing about tabs or sessions and must not learn — a shared mechanism that grows a branch per caller
has become two implementations wearing one name.

**Where the pointer is, is asked of the document, not of the event.** While a drag is live the window holds
the pointer, so the event target is the row the press began on and never the row underneath. The one shared
helper resolves the point instead: the nearest element matching a caller's selector at those coordinates.
Both callers ask the same question — "what am I over right now" — and neither can answer it any other way.
