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

Move through the spec tree by **relationship, not geometry** — the tree sits at fixed positions and never re-plots; the camera moves.

## keymap

**Board** (graph mode):

| key | action |
|---|---|
| `↑`/`k`, `↓`/`j` | up / down the focus node's column |
| `←`/`h` | to the parent |
| `→`/`l` | to the nearest child (closest in y); on a leaf, to the nearest node in the columns to the right (grid-weighted) |
| `+`/`-`, `0` | zoom in / out, back to overview zoom |
| `i`, double-click | open the node-info popup |
| `Enter` | cross into the node's live session(s) |
| `t` | toggle spec graph ↔ session graph |
| `?`, `,` | help overlay, settings |
| `nn`, `dd` | chord: new child under focus, delete focus |

**Inside the popup** (keys re-bind to the popup, never the board behind):

| key | action |
|---|---|
| `←`/`→`, `h`/`l`, `Tab`, `1`-`3` | switch pane (spec / recent / history), wrapping |
| `j`/`k`, `↑`/`↓` | scroll the open pane |
| `Enter` | cross to the node's session (popup closes behind it) |
| `Esc` | close the popup |

## principles

- **Move by relationship, not geometry.** Navigation walks the parent/child/column structure (see [[node-graph]]), never raw pixel distance. `↑`/`↓` stay strictly within the focus node's column — depth pins x, so a column is a clean reversible vertical line. `hjkl` mirror the arrows for the vim hand. The one exception is a **leaf's right arrow**: with no child to dive into, rather than dead-end it steps to the nearest node in the columns to its right — and even there the distance is normalised into grid cells (so the wide column gap and the narrow row gap weigh equally), never raw pixels. It only ever moves rightward, so the parent key still walks you back.
- **The camera follows the keyboard, not the mouse.** Arrow nav recentres the viewport on the new node — a flat-pan at constant zoom, never zoom-to-fit. A mouse click only moves the highlight; the board stays put. Same focus state, two interaction logics.
- **A modal owns the keys.** While the popup, help overlay, settings, or session interface is open it captures every key — nav never leaks to the board behind it.

## focus & sessions

A node does **not** belong to a session. `node.session` is only the *last editor* (a "last edited by" attribution), never a live link. The live link is the overlay — the session(s) whose pending ops currently touch the node, marked on the board by a `⏎` affordance.

`Enter` crosses from *reading* a node to *driving* its agent, resolving by how many editors are live: **one** → jump straight in; **none** → open New Session prefilled with `@<node-id>`; **several** → open the session interface to pick which editor to drive.

## node chords

`nn` (new child) and `dd` (delete) are **node ops on the focus**, never destructive on the live tree. A chord opens the session board's New Session input pre-seeded with an `@`-directive (`@new under @<parent>:` / `@delete @<node>:`); the human confirms, and the backend performs the op in a fresh worktree and dispatches an agent to finish it. The uncommitted mutation shows on the board's overlay at once.

## HUD & help

The HUD carries only the brand and a discreet `?`. The full keymap and the node's visual vocabulary (status dots, op glyphs, badges, rings) live together in **one** centered, scrollable modal — `?` opens it; `Esc`, a backdrop click, or its `×` closes it. There is no second copy of the legend.

## governed file

`App.jsx` — the app shell and the capture-phase keydown handler that routes every key to navigation or the active modal — is this node's single governed file. The graph it also renders is specified by [[node-graph]], but the file's reason to exist, and its churn, is the keyboard contract here.
