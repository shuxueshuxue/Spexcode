---
title: tab-routing
status: active
hue: 215
desc: Workspace tab identity, placement, focus, and explicit hold gestures.
related:
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/tabModel.js
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionForestPanel.jsx
  - spec-dashboard/src/SessionsView.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/keymap.js
---
# tab-routing

Tab identity is the canonical object address. Session terminal, conversation, and diff faces share one session
identity; a published resource is a separate file-class identity. Spec, Evals, Issues, and Settings details share
one resident page identity, while their selected detail remains in the URL. Graph, bare Sessions, New Session,
and empty workspace routes are not documents and never enter the strip.

Opening an already-held address focuses that tab. Ordinary navigation replaces only the currently focused
unpinned tab. If the requested kind has an unpinned tab elsewhere, that inactive document is preserved and the
new address is appended; pinned tabs are never passively replaced. This protects a document the reader is not
looking at without making every plain click a permanent tab.

Creating a session from the New Session composer is an explicit new-document action. The returned id is marked
held before the route is written, so creation appends a fresh session tab and cannot evict the prior session.
Resources are held at birth. A deep link creates an object tab when no matching tab exists.

Every row surface uses the shared `isHoldGesture`, `markTabHold`, and `pinTab` mechanism. Plain anchors retain
browser behavior; ctrl/command-click, double-click, palette ctrl/command-Enter, and the explicit row-menu action
hold an address. The Sessions view writes through its `ViewScope`; the shared tab store observes the resulting
route and applies placement exactly once.
