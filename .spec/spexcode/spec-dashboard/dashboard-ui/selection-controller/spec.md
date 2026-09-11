---
title: selection-controller
status: active
hue: 198
desc: One workspace selection snapshot seam for native DOM, CodeMirror, and terminal reading adapters; selection is reader state, actions consume it, and no reading surface cancels the browser gesture.
code:
  - spec-dashboard/src/selectionController.js
related:
  - spec-dashboard/src/Root.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/ProseActions.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/DiffDocument.jsx
  - spec-dashboard/src/focus.js
  - spec-dashboard/src/codeSelection.js
  - spec-dashboard/test/diff-scroll-survives-refresh.e2e.mjs
---
# selection-controller

Reading text has one selection contract. The browser's native DOM `Range`, CodeMirror's read-only editor
selection, and a terminal's own selection service are three transport adapters at the edge; product actions do
not know which one supplied the passage. Each adapter publishes one lossless snapshot `{surfaceId, kind, text,
semantic, visualRect, source}` to the workspace controller. `semantic` carries the address a reader can act on —
file and line range, node and line range, or session and timestamp — while `source` stays opaque to consumers.

The controller is state, not a renderer. It never paints a highlight, installs a custom mouse driver, or moves
focus. A reading surface must leave its pointer gesture native; focus protection applies only to explicit chrome
and overlays. Copying, quoting, commenting, and dispatching consume a frozen snapshot so opening an action cannot
make the selection disappear underneath it. When no action is claimed, the browser's own context menu remains.

The terminal keeps xterm's selection service because the terminal is itself a pointer protocol; that adapter is
the exception at the transport boundary, not a model for ordinary text. DOM and CodeMirror surfaces remain
browser/CM-native and use the same snapshot seam. Composer drafts and carets are independent application state,
so preserving a draft never requires cancelling a reader's selection.
