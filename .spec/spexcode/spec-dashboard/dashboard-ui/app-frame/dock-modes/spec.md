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
**sessions** finds active sessions. The mode is a local workspace preference, persisted like dock visibility,
because it answers what this window is looking for rather than naming a document in the URL. The mode belongs
to the rail's activity-bar buttons, not to a second control strip inside the dock.

The rail mode buttons change only the finding projection; they never change the active document, the tab list,
or session selection. Clicking the already-selected button closes the dock; clicking the other opens the dock
in that projection. Explorer rows retain [[file-tree]]'s route behavior.
Session rows reuse [[session-row]]'s projection and follow [[tab-strip]]: a plain click navigates to
`sessions/<id>` in the current slot, while ctrl/⌘-click calls `requestTab` to hold a new document.

**THE DOCK IS ONE BAND.** One header row serves both projections: the projection's name in sentence case,
its tally, and the doors that projection owns. Switching projection changes what the dock LISTS, never how
thick the dock is — which is the [[ui-state-model]] budget made structural rather than remembered. A
projection may not mint a strip of its own; the explorer's own count row, the sessions `+` row and the
archive door were three separate strips stacked around one list, three answers to a question this row
already answers once.

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

The dock mode is not a second navigation model and does not read the global address. Shell owns the mode
preference and passes the selected projection its board data. Below the one header row the dock renders
content only — the tree, or the session forest. There is no dock modebar.

**Its resting width is a margin, not a column.** The dock opens at 200px and will not be dragged below
160px: wide enough that a session headline or a file name reads before it ellipses, narrow enough that the
finding surface stays beside the document rather than competing with it. A reader who wants more drags it
and that choice is what persists, so the default only decides what an unopinionated window looks like.
