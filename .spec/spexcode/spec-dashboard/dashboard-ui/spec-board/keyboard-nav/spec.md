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

## one registry, two readers

The keymap is **one declarative table, not a literal scattered across the handler**. `keymap.js` lists every board binding as a record — `{ id, keys, rebind, desc }`: a stable action id, its default keyboard key(s), whether it is user-rebindable, and the i18n key for its one-line description. That single table is the source two readers project from, so they can never drift apart: the **handler** dispatches from it (below), and the **help legend** renders it (the keymap half of the one help modal — see [[node-graph]]). Add a verb once, in the table, and both follow.

The split that keeps this from spending complexity: **the registry owns the *binding*, never the *behavior*.** The handler bodies — the chord buffer, the focus-follow pan, the scope-following overlay cycle — stay exactly where they are; the registry only decides *which physical key names which action*. So the indirection is one resolver (`bindings.js`: `firesKey(id, key)`, honoring user overrides), not a re-implementation of the keys.

**Rebinding follows that same line.** The discrete board **verbs** are rebindable — a user key override is saved per-action in `localStorage`, merged over the table's defaults, and reset on demand; the [[settings]] popup is the editor. The **structural** keys are *not* user-rebindable and the table marks them so: the arrow/vim **nav** keys (they ARE the relationship-walk, not a verb), and the `n`/`d` **chords** (a two-key grammar, not a single binding). They still appear in the legend and the editor — shown, fixed.

A **game controller** drives this same keymap, but from **entirely outside the browser** — the [[game-controller]] extension (its own package, its own repo) maps the pad to these very keys as **real** OS keystrokes. That is deliberate: a real keystroke reaches the board AND OS-level facilities an in-page synthetic event never could. There is **no runtime link** to this registry — if a user rebinds a key here, they re-configure the controller too. This node owns the keyboard contract only.

## principles

- **Move by relationship, not geometry.** Navigation walks the parent / child / column structure (see [[node-graph]]), never pixel distance: up/down within the focus column, left to the parent, right to the nearest child. The one exception is a leaf's right key — with no child below it, it steps to the nearest node in the columns to its right, in grid cells (column and row gaps weigh equally) and only rightward, so the parent key walks back.
- **The camera follows the keyboard, not the mouse.** Arrow nav flat-pans onto the new node at constant zoom, never zoom-to-fit. A **mouse click re-focuses and drills the clicked node open, but the board stays** — the camera does not move. This is safe because node positions are a **fixed structural embedding**: a node's x/y is a function of tree shape alone (see [[node-graph]]), never of which node currently has focus, so expanding in place shifts nothing already on screen. Only a keyboard move — or a **programmatic jump** (search, board-stats, a session row) onto a possibly-offscreen node — pans the camera.
- **While the keyboard drives, the mouse steps aside.** A nav keystroke puts the board in *keyboard mode*: the cursor hides and the board takes no pointer events — suppression that reaches into React Flow's own node/edge layers, which otherwise re-enable pointers — so a still cursor can't fire a hover affordance (the issue popover, any future hover reveal). The focused node's own popover still shows — a focus reveal, not hover. Only a real pointer move exits the mode, not a pan under a still cursor.
- **A modal owns the keys.** While any popup, help overlay, settings, search palette, or session interface is open it captures every key — nav never leaks to the board behind it.

## search, jump & cycle

The board is a drill-down (see [[node-graph]]), so a node in a collapsed subtree is invisible until you walk its spine. **Slash-to-search** is the escape hatch, spanning **four planes at once** — spec nodes, live sessions, node-bound issues, and scenarios — each row tagged with its plane. Matching is **weighted, prose last**: a name/id prefix or substring wins; at the *lowest* weight the row's prose — a spec's `desc` + body, a scenario's `expected` — so a word found only in a node's spec still surfaces it, never above a name hit. The spec itself is searched, not just its name — it is the ground truth worth searching. Picking **routes by kind**: a node, issue, or scenario sets focus (an issue or scenario lands on its bound node) and expand-on-focus reveals and pans to it; a session jumps to its tab (see [[session-console]]). The **overlay-cycle** keys aim the same at *change* not name — cycling focus through the nodes a worktree is editing, wrapping; **scope follows the lock**: a locked session's changed nodes, else every in-flight edit.

## focus, sessions & chords

A node does **not** belong to a session; `node.session` is only a last-editor attribution. The live link is the overlay — the session(s) whose pending ops currently touch the node. **Enter** drives the node's agent by how many editors are live: one jumps in, none opens a New Session prefilled with the node mention, several open the interface to pick. The **fresh-session** key is its unconditional counterpart — always a *new* session on the focus. The new-child and delete **chords** are likewise node ops on the focus, never destructive on the live tree, each pre-seeding the New Session input with an `@`-directive to confirm.

## HUD & governed file

While a session is locked a top-center **lock banner** names the grip and points at the overlay-cycle keys (or says it has none). **Esc releases the lock**, firing only with no modal open and a session locked. The full keymap and the node's visual vocabulary live in **one** centered scrollable modal that help opens; vim/arrow keys glide its body and the node-info popup's pane alike — and that modal renders the keymap straight from the registry.

That up/down glide is one **shared momentum scroller** (`scroll.js`): a key press eases toward an accumulating target so held/repeated keys stack into one glide. That target is trusted **only while the surface still sits where the glide last left it** — so **a manual scroll wins**: any wheel/trackpad/drag (or a switch to another surface) drops the stale target, and the keyboard resumes from where the user actually is, never snapping back to the last keyboard-reached spot. This holds whether the manual move lands mid-glide or between key presses; the glide self-detects it by comparing `scrollTop` against the value it last wrote, so it needs no scroll listeners. The governed files are `App.jsx` — the capture-phase keydown handler that resolves each key against the registry (`firesKey`) and routes the named action to navigation or the active modal, rendering [[node-graph]] but existing for the keyboard contract — `cycle.js`, the `cycleNext` ring primitive [[board-stats]] also walks, and the two files that are the registry itself: `keymap.js` (the action table) and `bindings.js` (override load/save/merge/reset + `firesKey`). Its only slice of the shared `styles.css` is the keyboard-mode pointer-suppression rules; the yatsu eval tab's `.eval-*` classes there are a sibling's churn, not keyboard-nav's drift.
