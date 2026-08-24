---
title: file-view
status: active
hue: 198
desc: A file addressed as a document of its own, for a reader who arrived at the file rather than at the node claiming it.
code:
  - spec-dashboard/src/FileView.jsx
related:
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/FileTree.jsx
---
# file-view

The file document owns the address and tab boundary; its renderer is the child [[source-view]]. This split keeps
document navigation here and read-only window rendering in one implementation leaf.

A file opened as its own document, at its own address. Governed worktree paths use `#/file/<path>` and
node attachments use the same address family with a `.spec/<node>/<name>` logical path. The latter still
uses the node-owned attachment API because `.spec/**` is intentionally outside the governed-source gate.

It adds nothing to [[source-view]] but an address — and that is the point. A file opened from the dock, a
file opened under the spec that claims it, and a file opened from a shared link must be the same reader;
giving each its own would be three chances to diverge on what a line number means.

**The path lives in the tab and the address, nowhere else.** The file once contributed its path to
[[status-bar]]'s registry; the owner withdrew that item (2026-08-24) — the workspace tab and the address
already name the document, so the bar copy was ambient noise, and a title strip of its own would still be
a chrome band ([[ui-state-model]]) saying the same thing a third time. This view contributes nothing to
the status bar.

It exists because arrival is not always through a node. A reader following a path from a diff, a colleague's
link, the tree's file row, or a spec chip is looking at a *file*, and asking them to first find which node
governs or carries it would be asking them to answer a question they do not have. FileView owns no tab
placement policy; ordinary and held navigation are supplied by [[tab-strip]].
