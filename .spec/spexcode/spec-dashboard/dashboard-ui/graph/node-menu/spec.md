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
the node first (the clicked tile stays screen-stable while the camera absorbs any layout delta — the same
anchor contract as click), so the menu always acts on the node under the cursor and the board visibly agrees
about which node that is.

The menu exposes the node verbs plus one document door and one address handoff, with no new node mutation
behind them:

- **node info** — the node's own `#/spec/<id>` document ([[spec-view]]), which is this menu's door to
  reading the node. It lands in the workspace's current Spec tab rather than a second one, because a spec
  detail canonicalizes to ONE resident top-level tab ([[tab-strip]]); the graph therefore offers no
  "open in a new tab" here, because there is no second spec tab for the model to mint.
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
currently touch it — the menu appends, below a divider from the
five fixed actions, **one item per overlaying session** using the shared [[session-picker]] row: the
deterministic avatar, `sessionDisplayState` status-coloured glyph, and stable session handle. The handle is
the same identity used by the dock, mentions, and prose dispatch, so a session reads identically everywhere.
Picking one opens that session in the console ([[session-console]]) through the shared [[session-picker]] row
language. **A node's action menu is where a crossing
into an *existing* session lives** — the graph deliberately has no bare keystroke for it and the
node-info popup's Enter is inert ([[keyboard-nav]]), so the mouse menu is where "jump into the session
editing this node" belongs. A node with no overlay shows only the five fixed actions — no divider, no empty
section.

**Which sessions those are is one join, not this menu's own.** The overlays name worktree paths and a
session row carries that same path, and both node action menus resolve it through the single shared
crossing join rather than each repeating the match. The document surface has a node action menu of its own
([[spec-view]], [[prose-dispatch]]) and carries these same rows: a `[[node]]` reference lands its reader on
`#/spec/<id>`, where there is no tile to right-click, so the crossing must be reachable there too. That is
one crossing on two menus, never a second mechanism.

Dismissal follows the dashboard's shared menu conventions ([[session-rename]]'s row menu): any click
outside closes it, Esc peels it through the [[esc-layers]] stack (never closing the board surface
behind it), ordinary actions close before they fire, the copy row closes after its brief result, and a right-click anywhere while it is
open dismisses it — on another node that re-aims the menu there; anywhere else the browser's default
menu takes over. It reuses the session menu's `.sess-menu` visual vocabulary rather than introducing a
second menu style. Only spec nodes claim right-click; the rest of the board keeps the default menu.

That vocabulary is [[context-menu-chrome]]. This node supplies the fixed verbs and overlay-session rows;
the shared shell supplies compact icon-led geometry, groups, separators, theme states, and menu semantics.
