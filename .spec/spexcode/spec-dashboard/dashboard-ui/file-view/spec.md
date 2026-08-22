---
title: file-view
status: active
hue: 198
desc: A governed source file addressed as a document of its own, for a reader who arrived at the file rather than at the node claiming it.
code:
  - spec-dashboard/src/FileView.jsx
related:
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/FileTree.jsx
---
# file-view

A governed source file opened as its own document, at its own address.

It adds nothing to [[source-view]] but a title and an address — and that is the point. A file opened from
the dock, a file opened under the spec that claims it, and a file opened from a shared link must be the
same reader; giving each its own would be three chances to diverge on what a line number means.

It exists because arrival is not always through a node. A reader following a path from a diff, a colleague's
link, or the tree's file row is looking at a *file*, and asking them to first find which node governs it
would be asking them to answer a question they do not have.
