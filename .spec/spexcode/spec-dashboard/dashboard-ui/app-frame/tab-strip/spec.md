---
title: tab-strip
status: active
hue: 215
desc: The workspace document strip — one address grammar for opening, focusing, holding, and closing documents.
code:
  - spec-dashboard/src/tabs.js
related:
  - spec-dashboard/src/tabModel.js
  - spec-dashboard/src/tabModel.test.mjs
  - spec-dashboard/src/subtractive-boundaries.test.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionForestPanel.jsx
  - spec-dashboard/src/SessionContextMenu.jsx
  - spec-dashboard/src/SessionsView.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/keymap.js
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

The strip is the workspace working set. It is present on every route, uses the shared `page + param + query`
address grammar, and never creates a second navigation model. Object documents include sessions and files;
resident boards use one canonical tab identity while their detail remains route state. Graph, empty workspace,
bare Sessions, and the New Session form have no document identity and therefore do not become tabs.

The open list is local workspace state; the active tab is the URL. A tab click and an ordinary link use the same
navigation path, so the strip, deep links, and browser history agree. Session base faces are URL selectors on one
session tab; published resources are separate pinned file-class tabs. The shell owns the strip's position in the
frame and the document-actions slot at its right edge; documents do not render a second tab rail.

Three focused child contracts keep this node readable:

- [[tab-routing]] owns canonical identity, focus, placement, and the explicit hold gestures. Ordinary navigation
  replaces only the focused unpinned tab; an inactive tab is preserved and a new slot is appended. Session creation
  (the New Session composer, a prose-dispatch send to a new target) holds the published session before routing:
  a created document is a gesture, never a slot write.
- [[tab-lifecycle]] owns close behavior, focus history, nearest-neighbor fallback, and resource/session return.
- [[tab-layout]] owns the strip's visible row, drag ordering, wrapping, labels, seams, and action-cluster geometry.

The cross-surface law is one mechanism: row surfaces use the shared hold predicate and tab APIs, while views
write addresses through their host scope. The strip itself owns no session lifecycle actions beyond the shared
tab close menu; session rename/archive/close remains the session document or row menu's concern.
