---
title: keyboard-nav
status: active
session: sess-1c9d
hue: 320
desc: Move by relationship, not geometry.
code:
  - spec-dashboard/src/App.jsx
---
# keyboard-nav

## raw source

Move by relationship on a stable, depth-aligned tree — not by raw pixel distance. The tree never
re-plots; the camera moves. A Van Wijk zoom arc once made switching nodes "jump too high", so the
camera must flat-pan at constant zoom, never zoom-to-fit.

The **camera follows the keyboard, not the mouse**. Arrow-key navigation and mouse selection are
different interaction logics: walking the tree by arrow keys recentres the viewport on the new node
(you asked to go there), but clicking a node only moves the highlight — the camera stays put (you're
pointing, not travelling). Conflating them made clicks yank the board around.

A node does **not belong to a session**. `node.session` is only the *last editor* (attribution), not a
live link. The live link is the overlay — the session(s) currently editing a node — and that is what
the friction-reducer crosses into.

## expanded spec

### key map

On the board:

- `↑` / `k` — up the focused node's column, to the nearest node above
- `↓` / `j` — down the column, to the nearest node below
- `←` / `h` — to the parent
- `→` / `l` — to the nearest child (closest in y)
- `+` / `-` — zoom in / out; `0` — back to the overview zoom
- `i` — open the node-info popup
- `double-click` — focus a node **and** open its popup (the mouse twin of `i`)
- `Enter` — cross from the focus node into its live session(s)
- `nn` — new child node under the focus (chord)
- `dd` — delete the focused node (chord)
- `?` — open the help overlay (keymap + legend)

Inside the node-info popup the keys re-bind to the popup, never the board behind it:

- `←` / `→`, `h` / `l`, `Tab`, `1`-`3` — switch pane (spec / recent / history), cycling and wrapping
- `j` / `k` — scroll the open pane's content
- `Enter` — cross to the node's session (the popup closes behind it)
- `Esc` — close the popup

### the HUD and the help overlay

The on-screen HUD stays out of the way: it carries the brand and a single discreet `?` — nothing more.
The full keymap and the node's visual vocabulary (status dots, op glyphs, badges, rings) live together in
**one** place: a centered, large, scrollable modal overlaid on a dimmed backdrop. `?` (key or clicking the
HUD affordance) opens it; it owns the keys while open so nav never leaks to the board behind; `Esc`, a
backdrop click, or its `×` closes it. There is no second copy of the legend — the modal is its only home.

### principles

- **Move by relationship, not geometry.** Navigation walks the parent/child/column structure of the
  tree, not raw pixel distance. The tree sits at fixed absolute positions (see [[node-graph]]) and never
  re-plots; the camera moves instead.
- **The camera follows the keyboard, not the mouse.** Arrow nav recentres the viewport on the new node —
  you asked to travel there. A mouse click only moves the highlight; the board stays put — you're
  pointing, not travelling. Same focus state, two interaction logics.
- **A modal owns the keys.** While the popup or the session interface is open, arrows never leak through
  to pan the board behind it.

### moving on the board

`←` / `→` step to the parent and to the nearest child in y. `↑` / `↓` move strictly within the focused
node's **column**: depth pins x exactly, so a column is a clean vertical line and vertical nav never
changes column or dives into a child. Columns are the organised axis (aligned; rows aren't), and a
column's nodes are ordered in y, so the move is reversible. **`hjkl` mirror the arrows** for the vim
hand. Arrow nav is the *only* thing that pans: it moves the highlight and flat-pans the camera to centre
the new node at constant zoom — no zoom-to-fit, no arc, so switching nodes never jumps. `+` / `-` zoom
around the focus; `0` returns to the overview zoom.

### node chords (the key buffer)

The board has a small **vim-style key buffer**: a leader letter opens a pending chord, the matching next
letter fires it, and a non-matching key or a short lull clears the buffer and falls through (so single-key
nav is never shadowed — chord leaders aren't nav keys). Two chords today, both **node ops on the focus**:

- `nn` — **new child node** under the focus.
- `dd` — **delete** the focused node.

A chord does **not** act on the board directly. It opens the session board's New Session input pre-seeded
with an `@`-directive (`@new under @<parent>:` / `@delete @<node>:`) that encodes the op + target; the human
edits/confirms and submits. The backend then performs the op in a **fresh worktree** and dispatches the
session's agent to finish it: for `nn` it writes a placeholder child node and the agent names + specs +
implements it; for `dd` it removes the node's directory and the agent reads git history to refactor the
governed code. The mutation is uncommitted, so the board's overlay shows it (added ghost / delete mark) at
once. Nothing is destructive on the live tree — every op is isolated in its worktree until merged.

### the node-info popup

`i` (or a double-click) opens the popup over the board to read the node ([[work-pane]] /
[[ab-screenshots]]). It keeps the keys close to the node world it overlays: the **horizontal** hand
(`←` / `→`, `h` / `l`, alongside `Tab` and `1`-`3`) flips between its panes, and the **vertical** hand
(`j` / `k`) scrolls the open pane's text. Held or repeated scroll keys glide as one continuous motion.
Arrows never reach the board; `Esc` closes the popup.

### crossing into a session

The popup is a launchpad, not a dead end: `Enter` — from the board or the popup — crosses from *reading*
a node to *driving* its agent. The destination is the node's **live editor(s)**: the session(s) whose
pending ops currently touch it — never `node.session`, which is only the last editor, kept as a "last
edited by" line. It resolves by how many are live: **one** → jump straight in; **none** → open New
Session prefilled with `@<node-id>` (start working on it in place); **several** → open the session
interface so the human picks which editor to drive. A node carrying live editor(s) shows a subtle `⏎`
affordance on the board.

### the governed file

`App.jsx` is this node's **single** governed file — the app shell and the **capture-phase keydown
handler** that routes every arrow/`hjkl`/`i`/`Enter`/`?`/`Esc` to navigation or the active modal. It is
exclusively keyboard-nav's: the graph rendering it also wires up (react-flow `nodes`/`edges`, overlays,
the legend card) is specified by [[node-graph]], but the file's reason to exist — and its churn — is the
keyboard contract here, so [[node-graph]] no longer co-claims it and that churn stops reading as the
graph's drift.
