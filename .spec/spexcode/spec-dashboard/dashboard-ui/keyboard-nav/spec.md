---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/scroll.js
  - spec-dashboard/src/cycle.js
  - spec-dashboard/src/styles.css
---
# keyboard-nav

Move through the spec tree by **relationship, not geometry** — the tree sits at fixed positions and never re-plots; the camera moves.

## keymap

On the board, arrows (or vim keys) walk the focus through the tree (below); the rest are direct verbs — zoom and reset-to-overview, the node-info popup, search, cycle in-flight edits, cross into / start a fresh session, help, settings, new-child / delete chords. (The session relationship graph has no keybinding — it opens from its floating board button.) A board-level Esc only releases a locked session. Inside any popup the keys re-bind to it: left/right (or vim, or a numbered pane) switch panes, up/down scroll, Enter crosses, Esc closes.

## principles

- **Move by relationship, not geometry.** Navigation walks the parent / child / column structure (see [[node-graph]]), never pixel distance: up/down within the focus column, left to the parent, right to the nearest child. The one exception is a leaf's right key — with no child below it, it steps to the nearest node in the columns to its right, in grid cells (column and row gaps weigh equally) and only rightward, so the parent key walks back.
- **The camera follows the keyboard, not the mouse.** Arrow nav flat-pans onto the new node at constant zoom, never zoom-to-fit; a click only moves the highlight, the board stays.
- **While the keyboard drives, the mouse steps aside.** A nav keystroke puts the board in *keyboard mode*: the cursor hides and the board takes no pointer events — suppression that reaches into React Flow's own node/edge layers, which otherwise re-enable pointers — so a still cursor can't fire a hover affordance (the issue popover, any future hover reveal). The focused node's own popover still shows — a focus reveal, not hover. Only a real pointer move exits the mode, not a pan under a still cursor.
- **A modal owns the keys.** While any popup, help overlay, settings, search palette, or session interface is open it captures every key — nav never leaks to the board behind it.

## search, jump & cycle

The board is a drill-down (see [[node-graph]]), so a node in a collapsed subtree is invisible until you walk its spine. **Slash-to-search** is the escape hatch, spanning **three planes at once** — spec nodes, live sessions, and node-bound issues — each row tagged with its plane. Picking **routes by kind**: a node or issue sets focus (an issue lands on its bound node) and expand-on-focus reveals and pans to it; a session jumps to its tab (see [[session-console]]). The **overlay-cycle** keys aim the same at *change* not name — cycling focus through the nodes a worktree is editing, wrapping; **scope follows the lock**: a locked session's changed nodes, else every in-flight edit.

## focus, sessions & chords

A node does **not** belong to a session; `node.session` is only a last-editor attribution. The live link is the overlay — the session(s) whose pending ops currently touch the node. **Enter** drives the node's agent by how many editors are live: one jumps in, none opens a New Session prefilled with the node mention, several open the interface to pick. The **fresh-session** key is its unconditional counterpart — always a *new* session on the focus. The new-child and delete **chords** are likewise node ops on the focus, never destructive on the live tree, each pre-seeding the New Session input with an `@`-directive to confirm.

## HUD & governed file

While a session is locked a top-center **lock banner** names the grip and points at the overlay-cycle keys (or says it has none). **Esc releases the lock**, firing only with no modal open and a session locked. The full keymap and the node's visual vocabulary live in **one** centered scrollable modal that help opens; vim/arrow keys glide its body and the node-info popup's pane alike. The governed files are `App.jsx` — the capture-phase keydown handler routing every key to navigation or the active modal, rendering [[node-graph]] but existing for the keyboard contract — and `cycle.js`, the `cycleNext` ring primitive [[board-stats]] also walks. Its only slice of the shared `styles.css` is the keyboard-mode pointer-suppression rules; the yatsu eval tab's `.eval-*` classes there are a sibling's churn, not keyboard-nav's drift.
