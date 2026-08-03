---
title: node-menu
status: active
hue: 310
desc: Right-clicking a spec node opens a custom action menu — the mouse parallel of the board's node verbs — instead of the browser's default menu.
code:
  - spec-dashboard/src/NodeContextMenu.jsx#NodeContextMenu
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/test/node-menu-copy-url.e2e.mjs
---
# node-menu

Right-clicking a spec node on the board suppresses the browser's default context menu and opens a
**custom node menu** at the cursor. The board's design language already pairs mouse gestures with
keyboard verbs (click ↔ arrows, double-click ↔ `i`); this menu completes the pairing for the verbs a
mouse-only user otherwise cannot reach at all — the chords most of all. Right-click also **focuses**
the node first (expanding in place, no pan — same contract as click), so the menu always acts on the
node under the cursor and the board visibly agrees about which node that is.

The menu exposes the node verbs plus one address handoff, with no new node mutation behind them:

- **node info** — the `i` popup ([[node-popup]]).
- **copy node URL** — copies the canonical [[address-routing]] `graph-node` address as a full URL resolved
  against the current dashboard document. It therefore preserves the current public origin and `/p/<project>/`
  scope rather than baking a tunnel host into the product. Clipboard API denial or an HTTP context falls back
  to the browser copy path; the row briefly changes to copied or copy failed before the menu dismisses.
- **new session** — a fresh New Session pre-seeded with the node mention (the `[` verb).
- **new child node** — the `nn` chord's pre-filled instruction.
- **delete node** (danger-tinted) — the `dd` chord's pre-filled instruction.

The two chord items inherit the chords' safety contract ([[keyboard-nav]]): they only pre-seed a New
Session prompt the human completes and confirms — creating or deleting a node stays prompt-driven agent
work, never a direct server op, so a mis-aimed right-click can't destroy anything.

**Overlay sessions.** When the node carries session overlay(s) — a live worktree whose pending ops
currently touch it (`overlay.source === session.source`) — the menu appends, below a divider from the
five fixed actions, **one item per overlaying session**: a status-coloured glyph plus the session's **headline** —
the SAME live line the board rows show ([[session-activity]]'s one-name-every-surface / `sessionHeadline`),
never the stable label, so a session reads identically here and on the board it overlays.
Picking one opens that session in the console ([[session-console]]). This is the **one place a crossing
into an *existing* session lives** — the graph deliberately has no bare keystroke for it and the
node-info popup's Enter is inert ([[keyboard-nav]]), so the mouse menu is where "jump into the session
editing this node" belongs. A node with no overlay shows only the five fixed actions — no divider, no empty
section.

Dismissal follows the dashboard's shared menu conventions ([[session-rename]]'s row menu): any click
outside closes it, Esc peels it through the [[esc-layers]] stack (never closing the board surface
behind it), ordinary actions close before they fire, the copy row closes after its brief result, and a right-click anywhere while it is
open dismisses it — on another node that re-aims the menu there; anywhere else the browser's default
menu takes over. It reuses the session menu's `.sess-menu` visual vocabulary rather than introducing a
second menu style. Only spec nodes claim right-click; the rest of the board keeps the default menu.

That vocabulary is [[context-menu-chrome]]. This node supplies the fixed verbs and overlay-session rows;
the shared shell supplies compact icon-led geometry, groups, separators, theme states, and menu semantics.
