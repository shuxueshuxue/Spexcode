---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/scroll.js
  - spec-dashboard/src/cycle.js
  - spec-dashboard/src/keymap.js
  - spec-dashboard/src/bindings.js
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# keyboard-nav

Move through the spec tree by **relationship, not geometry** — the tree sits at fixed positions and never re-plots; the camera moves.

## keymap

On the board, arrows (or vim keys) walk the focus through the tree (below); the rest are direct verbs — zoom and reset-to-overview, the node-info popup, search, cycle in-flight edits, cross into / start a fresh session, help, settings, new-child / delete chords. (The session relationship graph has no keybinding — it opens from its floating board button.) A board-level Esc only releases a locked session. Inside any popup the keys re-bind to it: left/right (or vim, or a numbered pane) switch panes, up/down scroll, Enter crosses, Esc closes.

## one registry, three readers

The keymap is **one declarative table, not a literal scattered across the handler**. `keymap.js` lists every binding as a record — `{ id, ctx, keys, pad, desc }`: a stable action id, the context it lives in (`board` / `popup`), its default keyboard key(s), its default game-controller button, and the i18n key for its one-line description. That single table is the source three readers project from, so they can never drift apart: the **handler** dispatches from it (below), the **help legend** renders it (the keymap half of the one help modal — see [[node-graph]]), and the **[[controller]]** maps a gamepad button to the same action. Add a verb once, in the table, and all three follow.

The split that keeps this from spending complexity: **the registry owns the *binding*, never the *behavior*.** The handler bodies — the chord buffer, the focus-follow pan, the scope-following overlay cycle, the popup's pane-switch and momentum-scroll — stay exactly where they are; the registry only decides *which physical key (or button) names which action*. So the indirection is one resolver (`bindings.js`: `resolve(ctx, event) → id`, honoring user overrides), not a re-implementation of the keys.

**Rebinding follows that same line.** The discrete board/popup **verbs** are rebindable — a user override (a key, or a controller button) is saved per-action in `localStorage`, merged over the table's defaults, and reset back to them on demand; the [[settings]] popup is the editor. The **structural** keys are *not* user-rebindable and the table marks them so: the arrow/vim **nav** keys (they ARE the relationship-walk, not a verb), the `n`/`d` **chords** (a two-key grammar, not a single binding), and the popup's numbered-pane keys. They still appear in the legend and the editor — shown, fixed.

## principles

- **Move by relationship, not geometry.** Navigation walks the parent / child / column structure (see [[node-graph]]), never pixel distance: up/down within the focus column, left to the parent, right to the nearest child. The one exception is a leaf's right key — with no child below it, it steps to the nearest node in the columns to its right, in grid cells (column and row gaps weigh equally) and only rightward, so the parent key walks back.
- **The camera follows the keyboard, not the mouse.** Arrow nav flat-pans onto the new node at constant zoom, never zoom-to-fit; a click only moves the highlight, the board stays.
- **While the keyboard drives, the mouse steps aside.** A nav keystroke puts the board in *keyboard mode*: the cursor hides and the board takes no pointer events — suppression that reaches into React Flow's own node/edge layers, which otherwise re-enable pointers — so a still cursor can't fire a hover affordance (the issue popover, any future hover reveal). The focused node's own popover still shows — a focus reveal, not hover. Only a real pointer move exits the mode, not a pan under a still cursor.
- **A modal owns the keys.** While any popup, help overlay, settings, search palette, or session interface is open it captures every key — nav never leaks to the board behind it.

## search, jump & cycle

The board is a drill-down (see [[node-graph]]), so a node in a collapsed subtree is invisible until you walk its spine. **Slash-to-search** is the escape hatch, spanning **four planes at once** — spec nodes, live sessions, node-bound issues, and scenarios — each row tagged with its plane. Matching is **weighted, prose last**: a name/id prefix or substring wins; at the *lowest* weight the row's prose — a spec's `desc` + body, a scenario's `expected` — so a word found only in a node's spec still surfaces it, never above a name hit. The spec itself is searched, not just its name — it is the ground truth worth searching. Picking **routes by kind**: a node, issue, or scenario sets focus (an issue or scenario lands on its bound node) and expand-on-focus reveals and pans to it; a session jumps to its tab (see [[session-console]]). The **overlay-cycle** keys aim the same at *change* not name — cycling focus through the nodes a worktree is editing, wrapping; **scope follows the lock**: a locked session's changed nodes, else every in-flight edit.

## focus, sessions & chords

A node does **not** belong to a session; `node.session` is only a last-editor attribution. The live link is the overlay — the session(s) whose pending ops currently touch the node. **Enter** drives the node's agent by how many editors are live: one jumps in, none opens a New Session prefilled with the node mention, several open the interface to pick. The **fresh-session** key is its unconditional counterpart — always a *new* session on the focus. The new-child and delete **chords** are likewise node ops on the focus, never destructive on the live tree, each pre-seeding the New Session input with an `@`-directive to confirm.

## HUD & governed file

While a session is locked a top-center **lock banner** names the grip and points at the overlay-cycle keys (or says it has none). **Esc releases the lock**, firing only with no modal open and a session locked. The full keymap and the node's visual vocabulary live in **one** centered scrollable modal that help opens; vim/arrow keys glide its body and the node-info popup's pane alike — and that modal renders the keymap straight from the registry, each row now also showing its controller button. The governed files are `App.jsx` — the capture-phase keydown handler that resolves each key against the registry (`resolve`) and routes the named action to navigation or the active modal, rendering [[node-graph]] but existing for the keyboard contract — `cycle.js`, the `cycleNext` ring primitive [[board-stats]] also walks, and the two files that are the registry itself: `keymap.js` (the action table) and `bindings.js` (override load/save/merge/reset + `resolve`). Its only slice of the shared `styles.css` is the keyboard-mode pointer-suppression rules; the yatsu eval tab's `.eval-*` classes there are a sibling's churn, not keyboard-nav's drift.
