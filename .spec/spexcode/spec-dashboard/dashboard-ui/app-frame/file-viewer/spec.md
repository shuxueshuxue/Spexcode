---
title: file-viewer
status: active
hue: 202
desc: Where a file opened from the dock lands — a bounded reading layer, deliberately not a second pane.
code:
  - spec-dashboard/src/FileViewer.jsx
related:
  - spec-dashboard/src/Modal.jsx
  - spec-dashboard/src/SourceView.jsx
---
# file-viewer

A bounded reading window over the frame, on the board's shared modal chrome and the shared Esc layer, so it
dismisses the way every other overlay does.

It carries **no reading machinery of its own**. The same [[source-view]] renders a governed file and a
node's attachment, because they differ only in which gate admitted the bytes — the viewer takes a read
function and never learns which surface it is showing. That seam is the whole reason one component serves
both.

**It is a layer rather than a second pane on purpose, and the reason is a limitation, not a preference.**
Two documents side by side needs every page component to take a route instead of reading the global one.
Until that happens, a layer is the honest shape: it opens a document from anywhere without pretending the
frame can hold two.
