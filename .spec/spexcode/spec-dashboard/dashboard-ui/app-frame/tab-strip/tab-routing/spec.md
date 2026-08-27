---
title: tab-routing
status: active
hue: 215
desc: Workspace tab identity, placement, focus, and explicit new-tab gestures.
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

Opening an already-open address focuses that tab. Ordinary navigation replaces only the currently focused tab,
and only when the new address is of the same kind. When another kind is focused, when the focused route is not a
document (the graph, the launch page, a cold deep link), or when a same-kind tab exists only inactive elsewhere,
the inactive documents are preserved and the new address is appended. This protects a document the reader is
not looking at without making any tab permanent.

No tab is pinned or held. The tab a gesture appends is an ordinary tab: once it is focused, the next plain
same-kind navigation replaces it exactly as it would replace a tab that arrived by a plain click. Nothing about a
tab records how it arrived, and no persisted mark from an older release may revive such a distinction — the read
boundary drops `pinned`, `held`, and `preview`.

Creating a session — from the New Session composer or a [[prose-dispatch]] send to a new target — is an explicit
new-document action. The creating surface marks the returned id for a new tab before the route is written, so
creation appends a fresh session tab beside the one the reader was on and evicts nothing; every creation door
applies the same mark. A resource opened from its session document lands beside the session because the session
tab is of another kind, not because the resource is protected.

Every row surface uses the shared `isNewTabGesture`, `markNewTab`, and `openNewTab` mechanism. Plain anchors
retain browser behavior; ctrl/command-click, palette ctrl/command-Enter, and the explicit row-menu action open
an address in a new tab. Double-click has no tab meaning: its first click already navigated. The Sessions view
writes through its `ViewScope`; the shared tab store observes the resulting route and applies placement exactly
once, naming the tab that was focused before the route changed.
