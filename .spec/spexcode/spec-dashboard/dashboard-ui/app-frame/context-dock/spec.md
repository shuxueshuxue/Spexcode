---
title: context-dock
status: active
hue: 205
desc: The right context dock — backlinks and scenario health for the routed spec document.
code:
  - spec-dashboard/src/ContextDock.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/score.jsx
  - spec-dashboard/src/reviewPage.js
  - spec-dashboard/src/styles.css
---
# context-dock

The right-hand CONTEXT region answers “what surrounds this thing?”. It is a property of the document being
read, not a second finding surface and not another tab. The dock therefore follows the shell's routed
`{page, param}` for the **primary** document. In a split layout it deliberately continues to follow the
primary route and never follows the second pane: context answers the document the reader routed to, while
the second pane is an independently held document.

The dock exists only for `#/spec/<id>`. Other route kinds have no context projection, so they render no dock
and no empty placeholder. A node document gets two independently collapsible panels:

- **BACKLINKS** lists board nodes whose existing hierarchy or `related` edge points at the current node. It
  is derived from the board's resident `specs` projection, the same parent/relationship source the graph and
  file tree already use; it does not introduce a content fetch or a second edge store. Each row is a real
  `#/spec/<id>` anchor, so ordinary navigation, middle-click, and browser history keep their existing
  meaning.
- **SCENARIOS** joins the current node's declared scenario names with the latest result rows from the shared
  eval review projection. The join uses `scenarioStates` and the existing score badge vocabulary. Each row
  is a real `#/evals/<node>/<scenario>` anchor. An unmeasured declaration remains visible with the missing
  score state; a latest reading supplies pass, fail, or stale state.

The dock width uses `useResizable('spex.ctxWidth', ...)` and keeps the same min/max and release-time
localStorage persistence as the other shell panes. Panel disclosure and the dock's open state are also
local preferences in localStorage, defaulting open. The open/close control lives in the document-area
top bar beside the tabs: the workspace-shell rule says a control belongs to the region whose question it
answers, and context is neither the left finding rail nor ambient status, so a document-level context control
is the least surprising owner while still remaining reachable when the dock is closed.

The component receives `{page, param}` from `Shell`; it never reads the global address. Its API context and
state context remain separate by using the existing board/workspace hooks rather than introducing a mixed
context. A failed eval projection is shown as an explicit panel error; it is not silently rendered as an
empty scenario list.
