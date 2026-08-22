---
title: dock-modes
status: active
hue: 210
desc: The left finding dock's explorer and sessions projections.
code:
  - spec-dashboard/src/Dock.jsx
related:
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
---
# dock-modes

The dock is one finding surface with two projections: **explorer** finds governed files and spec nodes;
**sessions** finds active sessions. The mode is a local workspace preference, persisted like dock visibility,
because it answers what this window is looking for rather than naming a document in the URL.

The mode switch belongs at the dock's top edge. It changes only the finding projection; it never changes the
active document, the tab list, or session selection. Explorer rows retain [[file-tree]]'s route behavior.
Session rows reuse [[session-row]]'s projection and follow [[tab-strip]]: a plain click navigates to
`sessions/<id>` in the current slot, while ctrl/⌘-click calls `requestTab` to hold a new document.

The dock's session projection is intentionally read-only. It consumes the board's active session set and does
not own archive, launch, rename, drag, or terminal state. Those responsibilities remain in
[[session-console]]'s document view. When the same list is already visible in the dock, the document view
withdraws its internal list and gives the terminal/timeline the full content width; its New Session and archive
entry points remain available in their existing console surface for this milestone.

The dock mode is not a second navigation model and does not read the global address. Shell owns the mode
preference and passes the selected projection its board data.
