---
title: tab-strip
status: active
hue: 215
desc: The workspace document strip — one address grammar for opening, focusing, and closing documents.
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
session tab; published resources are separate file-class tabs. The shell owns the strip's position in the
frame and the document-actions slot at its right edge; documents do not render a second tab rail.

Every tab is an ordinary tab. There is no pinned, held, or preview state: a tab is an address in the working
set, drawn the same way whether it arrived by a plain click, by ctrl/⌘-click, or by creating a session, and
replaced the same way. A tab that could not be replaced was a tab whose history the reader had to remember;
the strip does not ask that of anyone.

Three focused child contracts keep this node readable:

- [[tab-routing]] owns canonical identity, focus, placement, and the explicit new-tab gestures. Ordinary
  navigation replaces only the focused tab of the same kind; an inactive tab is preserved and the new address is
  appended. Session creation (the New Session composer, a prose-dispatch send to a new target) appends the
  published session beside the tab the reader was on: a created document is a gesture, never a replacement.
- [[tab-lifecycle]] owns close behavior, focus history, nearest-neighbor fallback, and resource/session return.
- [[tab-layout]] owns the strip's visible row, drag ordering, wrapping, labels, seams, and action-cluster geometry.

The cross-surface law is one mechanism: row surfaces use the shared new-tab predicate and tab APIs, while
views write addresses through their host scope. The strip itself owns no session lifecycle actions beyond the shared
tab close menu; session rename/archive/close remains the session document or row menu's concern.
