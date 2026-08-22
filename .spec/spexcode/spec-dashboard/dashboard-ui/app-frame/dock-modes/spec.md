---
title: dock-projection
status: active
hue: 210
desc: The left finding dock's explorer and sessions projections, selected by the rail.
code:
  - spec-dashboard/src/Dock.jsx
related:
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---
# dock-modes

The dock is one finding surface with two projections: **explorer** finds governed files and spec nodes;
**sessions** finds active sessions.

**The sidebar is a property of the focused tab, not a setting the reader has to maintain** — both which
projection it shows and whether it exists at all. A session document belongs with the session list; a node
or a governed file belongs with the explorer. **Evals, issues and settings have no natural sidebar, so they
render none and the main area takes the full width.** That is isolation, not suppression: a board must not
INHERIT the dock the previous tab was showing. Inheriting it is what made the sidebar feel like a setting
being maintained beside the work — a tree left open beside a page that has no use for it, costing width, a
render, and a question in the reader's head about what it is for. Moving between tabs therefore moves the
sidebar with them, which is the whole activity-bar idea and the reason the rail's lit button reads as
"where this document belongs" instead of "which button was pressed last". The dock's WIDTH stays one
window-wide memory; what is isolated is whether it shows and which projection, not how wide the reader
likes it.

A rail mode button still selects a projection by hand, and that choice is a **temporary override**: it
holds while the reader stays on the same document and lapses the moment focus moves to another one. That is
what makes it an override rather than a second, competing setting; the derived answer is always one focus
change away. The mode is still persisted, so a reload opens on the last projection in force.

The rail mode buttons change only the finding projection; they never change the active document or the tab
list — with one exception that is the same principle: asking for **sessions** when the workspace already
holds a session tab focuses the most recently opened one, because "show me sessions" means the session the
reader has, not a launch page nobody asked for. When nothing is held the button is merely ARMED: the dock
opens on that projection and waits for a row to be picked. On a sidebar-less tab the buttons stage the
choice rather than forcing a dock onto a surface that has none — it appears with the next tab that owns
one, and the sessions button's return-to-a-held-session makes that immediate. Clicking the already-selected button collapses
the dock; clicking the other opens the dock in that projection. Explorer rows retain [[file-tree]]'s route
behavior. Session rows reuse [[session-row]]'s projection and follow [[tab-strip]]: a plain click navigates
to `sessions/<id>` in the current slot, while ctrl/⌘-click or a double-click holds it as its own tab.

**The dock closes from its own header, and the closing is a movement.** The rail button that opened a
projection still collapses it; the header carries the same door for the reader who is done with the panel
they are looking at — one state, two doors, never two states. Opening and closing SLIDE, for one shared
`--dur-panel` token rather than a duration invented per panel, and the element outlives the state that
hides it by exactly that long so the reverse is visible too. The animated property is max-width: the dock's
width is the reader's own inline resize, and a keyframe cannot outrank an inline style — `!important`
inside a keyframe is ignored by the spec, which is how the first version of this animated nothing at all.
Reduced-motion drops the animation and keeps both doors.

**THE DOCK IS ONE BAND.** One header row serves both projections: the projection's name in sentence case,
its tally, and the doors that projection owns. Switching projection changes what the dock LISTS, never how
thick the dock is — which is the [[ui-state-model]] budget made structural rather than remembered. A
projection may not mint a strip of its own; the explorer's own count row, the sessions `+` row and the
archive door were three separate strips stacked around one list, three answers to a question this row
already answers once.

**SEARCH IS ONE OF THOSE DOORS, and each head opens it on what that head LISTS.** The sessions head searches
sessions; the explorer head searches nodes. It is the same palette either way — same rows, same keys, same
matcher — and the projection only sets which plane leads ([[paged-palette]]'s `boost`). Search used to be a
rail button ([[side-nav]]), where it had to name a scope it could not know: it sat above both projections
and opened exactly one of them, so a reader asking "search what?" got whichever answer the button's author
had picked. Sitting inside the head row, the button needs no answer — the row it is in has already given
one. The keyboard follows the same rule rather than a second one: `/` opens the palette on the projection in
force, so the key and the visible door can never disagree.

The dock's session projection is the **one session list** in the desktop window. It consumes the board's active
session set through `sessionForest`, including zone headings, nesting rails, fold pods, status glyphs, and the
route-selected highlight (`activeSessionId`). The header's `+` navigates to `sessions/new` and its archive
door navigates to the sessions document's archive overlay. Both are finding-surface doors, while the archive
overlay and all session content remain in the holding region. Rows are read-only navigation: plain click
replaces the current tab and ctrl/command-click holds a new one.

**A session row is also where the graph is claimed.** Alt-click scopes the board to that session's worktree
— its nodes stay lit, every other node dims, and [[lock-hint]] names the claim. The row wears the claim
while it holds. This is the ONLY place the claim is made from a list, and it is why the graph no longer
floats a session window of its own ([[session-row]]): the claim belongs beside the sessions, and the lock
itself is [[workspace-shell]] state so the two surfaces need not know about each other.

**Right-click on a session row opens that session's own menu** — rename, tmux attach, lock on graph, close —
the same menu the selected session's document tools open from the actions slot. One menu, two ways in: the
dock reaches ANY row, the actions slot reaches the one you are reading. The menu moved here with the rows
when the console's own list was withdrawn; for one release it did not, and the rows carried a click and
nothing else, which left rename and attach with no pointer route anywhere in the window. A finding row
being a menu's anchor is not mutation state living in the dock: the row still only navigates, and every
action the menu offers is performed by the menu.

Archive, close, and resume actions remain document-side; rename remains reachable from the selected session's
document tools. Drag-to-reparent and multi-select are deliberately removed in this milestone rather than
silently disappearing: they were mutable gestures whose only home was the withdrawn list, and the dock's
finding projection must not grow mutation state. The existing keyboard fresh-session binding remains active.
When the dock is in sessions mode, `SessionInterface` renders no `si-list`, board scrollport, list resizer, or
48px stub: the terminal or timeline owns the entire document content region. This is the [[workspace-shell]]
four-region model made literal — FINDING on the left, HOLDING in the center, CONTEXT on the right, AMBIENT at
the bottom — so one window cannot expose two competing navigation lists.

The dock mode is not a second navigation model and the DOCK does not read the global address: the shell
derives the projection from the focused document and passes it down, exactly as it passes the board data.
Whether the dock renders is therefore two facts and not one — the reader's open/closed choice, and whether
the focused tab has a sidebar at all ([[ui-state-model]] counts the band from exactly those two). Below the one header row the dock renders
content only — the tree, or the session forest. There is no dock modebar.

**Its resting width is a margin, not a column.** The dock opens at 200px and will not be dragged below
160px: wide enough that a session headline or a file name reads before it ellipses, narrow enough that the
finding surface stays beside the document rather than competing with it. A reader who wants more drags it
and that choice is what persists, so the default only decides what an unopinionated window looks like.
