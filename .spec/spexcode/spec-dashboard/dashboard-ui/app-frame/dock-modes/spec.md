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

The dock's session projection is the **one session list** in the desktop window. It consumes the board's active
session set through `sessionForest`, including zone headings, nesting rails, fold pods, status glyphs, and the
route-selected highlight (`activeSessionId`). A `+` action at the projection head navigates to `sessions/new`;
a `View all` action at its foot navigates to the sessions document's archive overlay. Both are finding-surface
doors, while the archive overlay and all session content remain in the holding region. Rows are read-only
navigation: plain click replaces the current tab and ctrl/command-click holds a new one.

Archive, close, and resume actions remain document-side; rename remains reachable from the selected session's
document tools. Drag-to-reparent and multi-select are deliberately removed in this milestone rather than
silently disappearing: they were mutable gestures whose only home was the withdrawn list, and the dock's
finding projection must not grow mutation state. The existing keyboard fresh-session binding remains active.
When the dock is in sessions mode, `SessionInterface` renders no `si-list`, board scrollport, list resizer, or
48px stub: the terminal or timeline owns the entire document content region. This is the [[workspace-shell]]
four-region model made literal — FINDING on the left, HOLDING in the center, CONTEXT on the right, AMBIENT at
the bottom — so one window cannot expose two competing navigation lists.

The dock mode is not a second navigation model and does not read the global address. Shell owns the mode
preference and passes the selected projection its board data. The dock renders content only: the explorer's
`EXPLORER` count head or the sessions list's `+` and archive controls. There is no dock modebar.
