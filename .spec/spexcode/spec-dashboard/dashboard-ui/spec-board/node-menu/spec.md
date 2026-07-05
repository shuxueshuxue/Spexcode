---
title: node-menu
status: active
hue: 310
desc: Right-clicking a spec node opens a custom action menu — the mouse parallel of the board's node verbs — instead of the browser's default menu.
code:
  - spec-dashboard/src/NodeContextMenu.jsx
related:
  - spec-dashboard/src/App.jsx
---
# node-menu

Right-clicking a spec node on the board suppresses the browser's default context menu and opens a
**custom node menu** at the cursor. The board's design language already pairs mouse gestures with
keyboard verbs (click ↔ arrows, double-click ↔ `i`); this menu completes the pairing for the verbs a
mouse-only user otherwise cannot reach at all — the chords most of all. Right-click also **focuses**
the node first (expanding in place, no pan — same contract as click), so the menu always acts on the
node under the cursor and the board visibly agrees about which node that is.

The menu exposes exactly the existing node verbs, no new behaviour behind them:

- **node info** — the `i` popup ([[work-pane]]).
- **new session** — a fresh New Session pre-seeded with the node mention (the `[` verb).
- **new child node** — the `nn` chord's pre-filled instruction.
- **delete node** (danger-tinted) — the `dd` chord's pre-filled instruction.

The two chord items inherit the chords' safety contract ([[keyboard-nav]]): they only pre-seed a New
Session prompt the human completes and confirms — creating or deleting a node stays prompt-driven agent
work, never a direct server op, so a mis-aimed right-click can't destroy anything.

Dismissal follows the dashboard's shared menu conventions ([[session-rename]]'s row menu): any click
outside closes it, Esc peels it through the [[esc-layers]] stack (never closing the board surface
behind it), picking an item closes it before the action fires, and a right-click anywhere while it is
open dismisses it — on another node that re-aims the menu there; anywhere else the browser's default
menu takes over. It reuses the session menu's `.sess-menu` visual vocabulary rather than introducing a
second menu style. Only spec nodes claim right-click; the rest of the board keeps the default menu.
