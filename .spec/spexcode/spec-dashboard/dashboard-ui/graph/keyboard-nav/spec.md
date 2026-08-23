---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/keymap.js#ACT
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/scroll.js
  - spec-dashboard/src/cycle.js
  - spec-dashboard/src/bindings.js
  - spec-dashboard/src/KeyboardService.jsx
---
# keyboard-nav

Move through the spec tree by **relationship, not geometry** — focus changes add/remove frontier tiles while
the camera keeps the reading pair at its current anchor and absorbs any layout delta.

## keymap

On the board, arrows (or vim keys) walk the focus through the tree (below); the rest are direct verbs — zoom and reset-to-overview, the node-info popup (`i` or Enter — Enter is a plain alias for the info key, not a separate verb), search, cycle in-flight edits, start a fresh session, help, settings, new-child / delete chords. A board-level Esc only releases a locked session. Inside the node-info popup the **unmodified** keys re-bind to it: left/right (or vim, or a numbered pane) switch panes, up/down scroll, Tab/⇧Tab cycle, Esc closes — and **Enter is inert**: the popup is a pure reading surface, so Enter (like any unbound key) is swallowed and does nothing, never crossing into a session. The popup does not freeze the tree, though — it is a **lens, not a modal**: **Shift+nav** (⇧h/j/k/l and ⇧arrows) performs the same relationship walk as the bare board, and the popup follows the new focus, re-rendering onto whichever node the walk lands on — so reading ten sibling docs is ten ⇧j presses, never open-close-move-reopen. **Shift-passthrough is one global grammar**: on the bare board too, Shift+nav equals plain nav (the modifier is simply transparent to the relationship keys), so the same finger habit works with the popup open or closed. Across a lens move the **pane selection persists** — the new node opens on the pane you were reading — and when the new node lacks that pane the popup falls back to *its own* default (so the edit-tab-leads rule keeps holding); the shift keys live in the registry's structural nav family, not-rebindable and shown in the help legend like the rest.

The board claims only the shortcuts it names. Plain board verbs and relationship keys are **unmodified** keys; browser/system accelerators that carry Ctrl/⌘/Alt pass through untouched unless this contract explicitly declares that modifier family (`Alt+/` for cross-surface search, and the Alt page jumps from [[side-nav]]). So `Ctrl/⌘+L`, `Ctrl/⌘+R`, `Ctrl/⌘+,`, `Alt+←`, and neighbouring browser shortcuts never become graph navigation, popup, settings, or zoom commands by accident. The same restraint holds for **a focused native control**: when real DOM focus sits on a button, link, or form field (the HUD `?`, the lock release), Enter/Space are that control's activation keys — the handler steps aside so tabbing to a control and pressing Enter always equals clicking it; the board's Enter-as-info alias applies only while no control holds focus (graph tiles never collide — board focus is not DOM focus). Inside the node-info popup the restraint widens to the control's WHOLE key surface: while focus sits in a form field, an open menu, or on a menu trigger **inside the popup** (the embedded review filters, [[review-filters]]), every unmodified key belongs to that control — typing `h`/`l`/digits, caret arrows, menu roving, and ArrowDown-to-open never become pane switches or scrolls; only Escape falls through, and the one LIFO esc stack peels the menu before the popup. The widening is scoped to the popup's own controls: stray DOM focus resting on a control **elsewhere on the page** — the rail's project chip ([[side-nav]]) is also a menu trigger — never owns the popup's keys, so j/k keep scrolling regardless of where focus was left.

## one registry, three readers

The keymap is **one declarative table, not a literal scattered across the handler**. `keymap.js` lists every binding as a record — `{ id, keys, rebind, desc }`: a stable action id, its default keyboard key(s), whether it is user-rebindable, and the i18n key for its one-line description. That single table is the source three readers project from, so they can never drift apart: the **handler** dispatches from it (below), the **help legend** and the settings editor render it (the keymap half of the one help modal — see [[node-graph]]), and a **tooltip** names it — any control a key also reaches prints that key beside its label. Add a verb once, in the table, and all three follow.

The table also carries the shell's own ⌥ family, and there the registry is downstream of a product
decision rather than of this node's grammar: **the page-jump digits are the rail's order** ([[side-nav]]
owns which destinations exist and in what sequence). When a destination is withdrawn from the rail its
digit is withdrawn with it and the rest close up — the table never keeps a digit warm for a place the
workspace no longer sends anyone. That is why `⌥1` now names sessions: the spec-node graph left the rail
([[node-graph]]), so it left the digits.

**A binding the table does not hold is a binding nothing can render truthfully**, so a chord matched inline in some handler's body is a defect and not a shortcut: the console's Command Box chord was one, invisible to the legend, to the editor, and to its own tooltip. **And a hint typed into translated prose is the same defect wearing a label** — a copy no rebind reaches, duplicated per language, free to drift into a second glyph dialect, which is what left a rail entry advertising a modifier-less key for a chord that had moved. The dictionaries carry NAMES; the hint is appended by the reader from the live registry, with every modifier the chord actually has, and an action with no binding gets no hint. Chord glyphs are DERIVED from the binding token (`Alt+Shift+ArrowRight` → `⌥⇧→`) rather than looked up per chord, because a per-chord table is one more place a modifier can go missing.

The split that keeps this from spending complexity: **the registry owns the *binding*, never the *behavior*.** The handler bodies — the chord buffer, the focus-follow pan, the scope-following overlay cycle — stay exactly where they are; the registry only decides *which physical key names which action*. So the indirection is one resolver (`bindings.js`: `firesKey`/`firesEvent` for dispatch, `keysOf` and `shortcutHint` for display, all honoring user overrides), not a re-implementation of the keys.

**Rebinding follows that same line.** The discrete board **verbs** are rebindable — a user key override is saved per-action in `localStorage`, merged over the table's defaults, and reset on demand; the [[settings]] popup is the editor. The **structural** keys are *not* user-rebindable and the table marks them so: the arrow/vim **nav** keys (they ARE the relationship-walk, not a verb), and the `n`/`d` **chords** (a two-key grammar, not a single binding). They still appear in the legend and the editor — shown, fixed.

A **game controller** drives this same registry from **inside the page** — [[game-controller]]'s controller mode reads the pad with the Gamepad API and dispatches the same stable action ids, a second dispatcher beside the keyboard handler (nothing synthesized, so nothing untrusted). The registry stays the single meeting point: a key rebind changes which *key* fires an action, never the action a pad control is bound to, so the pad needs no re-configuration. This node owns the keyboard contract only.

## principles

**Camera rule (current).** Arrow nav, mouse click, and programmatic jumps all use [[node-graph]]'s reading-pair
anchor: focus→nearest child midpoint at the `43%` canvas token, or parent↔focus midpoint for a leaf, with the
focus row on the vertical axis and a vertical clamp that keeps the visible frontier reachable. If the visible
bbox already fits at the current user zoom, the camera fits it with one left gutter; that fit zoom is local to
the fit frame. Anchored navigation preserves the user's zoom and lowers it only when the anchored frontier
cannot fit. The existing smooth transition remains, clicks absorb the instantaneous 0px layout delta, and
graph-space coordinates are untouched.

- **Move by relationship, not geometry.** Navigation walks the parent / child / column structure (see [[node-graph]]), never pixel distance: up/down within the focus column, left to the parent, right to the nearest child. The one exception is a leaf's right key — with no child below it, it steps to the nearest node in the columns to its right, in grid cells (column and row gaps weigh equally) and only rightward, so the parent key walks back.
- **The camera follows keyboard and mouse with one target.** Arrow nav, mouse click, and programmatic jumps use the camera rule above. A **mouse click re-focuses and drills the clicked node open**; if the frontier re-plots, that clicked tile stays at its pre-click screen position and the camera absorbs the layout delta, so the world does not jump under the pointer.
- **While the keyboard drives, the mouse steps aside.** A nav keystroke puts the board in *keyboard mode*: the cursor hides and the board takes no pointer events — suppression that reaches into React Flow's own node/edge layers, which otherwise re-enable pointers — so a still cursor can't fire a hover affordance (the issue popover, any future hover reveal). The focused node's own popover still shows — a focus reveal, not hover. Only a real pointer move exits the mode, not a pan under a still cursor.
- **A modal owns the keys — but the node-info popup is a lens, not a modal.** While a *true* modal — help overlay, settings, search palette, or a session interface — is open it captures every key, and nav never leaks to the board behind it. The node-info popup claims only the **unmodified** keys (its pane/scroll/close vocabulary); **Shift+nav passes through** to the ordinary relationship walk, and the popup follows the focus. The distinction is what the surface *is*: help/settings/search are about themselves, so keys behind them are noise; the popup is about the focused node, so moving the focus is the reading gesture, not a leak.

## search, jump & cycle

The board is a drill-down (see [[node-graph]]), so a node in a collapsed subtree is invisible until you walk its spine. **Slash-to-search** is the escape hatch, spanning the **two planes a workspace holds** — spec nodes and live sessions — each row tagged with its plane, and it **opens on the plane the context implies**: the key is the twin of the dock head's search door ([[dock-modes]]), so whichever projection is in force is the plane that leads. Issues and scenarios are findings ABOUT a node and left the palette with their round-trips ([[paged-palette]]); they have list pages one ⌥digit away that do that job properly. Matching is **weighted, prose last**: a name/id prefix or substring wins; at the *lowest* weight the row's prose — a spec's `desc` + body, a session's headline and handle — so a word found only in a node's spec still surfaces it, never above a name hit. The spec itself is searched, not just its name — it is the ground truth worth searching. Picking routes through [[address-routing]]: spec nodes open their `#/spec/<id>` document, sessions jump to their tab (see [[session-console]]). The **overlay-cycle** keys aim at *change* not name — cycling focus through the nodes a worktree is editing, wrapping; **scope follows the lock**: a locked session's changed nodes, else every in-flight edit.

## focus, sessions & chords

A node does **not** belong to a session; `node.session` is only a last-editor attribution. The live link is the overlay — the session(s) whose pending ops currently touch the node. From the graph, **Enter opens the node-info popup — the same action as `i`**, the reading surface; the popup is read-only, so its **Enter is inert** (see the popup keys above) — it does not cross into a session. Crossing into a node's live session is a **mouse** verb: the right-click **node-menu** ([[node-menu]]) lists the node's overlay sessions and opens the one you pick. So the graph has no bare single-key jump straight into a session — the **fresh-session** key is the graph's one keyboard session verb, always a *new* session on the focus. The new-child and delete **chords** are likewise node ops on the focus, never destructive on the live tree, each pre-seeding the New Session input with a plain-prose instruction the human confirms before launch — creating or deleting a node is prompt-driven agent work, never a server op ([[dispatch]]).

## HUD & governed file

While a session is locked a top-center **lock banner** names the grip and points at the overlay-cycle keys (or says it has none). **Esc releases the lock**, firing only with no modal open and a session locked. The full keymap and the node's visual vocabulary live in **one** centered scrollable modal that help opens; vim/arrow keys glide its body and the node-info popup's pane alike — and that modal renders the keymap straight from the registry.

That up/down glide is one **shared momentum scroller** (`scroll.js`): a key press eases toward an accumulating target so held/repeated keys stack into one glide. That target is trusted **only while the surface still sits where the glide last left it** — so **a manual scroll wins**: any wheel/trackpad/drag (or a switch to another surface) drops the stale target, and the keyboard resumes from where the user actually is, never snapping back to the last keyboard-reached spot. This holds whether the manual move lands mid-glide or between key presses; the glide self-detects it by comparing `scrollTop` against the value it last wrote, so it needs no scroll listeners. The keyboard contract is split by [[keyboard-service]]: the shell owns the single capture-phase listener and dispatches shell-global commands on every routed view, while the active graph registers the relationship walk, popup-lens grammar, graph verbs, chords, and legend only while mounted. The registry files remain `keymap.js` (the action table) and `bindings.js` (override load/save/merge/reset + `firesKey`); `cycle.js` remains the `cycleNext` ring primitive [[graph-stats]] also walks. The handler host is no longer the deleted `Dashboard.jsx`; changing the host does not change this node's relationship or popup-lens grammar. Its only slice of shared `styles.css` is the keyboard-mode pointer-suppression rules; the eval tab's `.eval-*` classes there are a sibling's churn, not keyboard-nav's drift.
