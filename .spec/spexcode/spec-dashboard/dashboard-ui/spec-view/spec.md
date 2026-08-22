---
title: spec-view
status: active
hue: 195
desc: A spec node read as a document — its prose and the code it governs, side by side, in the main area.
code:
  - spec-dashboard/src/SpecView.jsx
related:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/styles.css
---
# spec-view

A spec node opened as a **document**: its prose on the left, the code it governs on the right, both there
when the document opens rather than one click inside the other.

This is the surface the whole refactor exists for. Its absence was the refactor's real failure for a while
— the board grew a status bar, a tab strip and a file dock while reading a spec still meant opening a popup
over a graph, with the governed file one more click inside that popup. Every piece passed its own
verification; none of them was the thing that had been asked for.

**The prose renderer is the same pane the popup uses, not a second one.** A document and a popup showing
the same node must never be two implementations that can disagree about what the node says. The popup keeps
its place as a quick lens on board focus; this is where a node is READ.

**The right side opens on the node's first governed file**, and a `code:` entry naming a symbol resolves to
its file — several such entries open one viewer, because the reader wants the file, not three views of it.
A node's attachments ([[node-attachments]]) sit in the same chip row: the reader is not asked to learn that
bytes from the spec tree behave differently from bytes from the worktree, even though the gate that admits
them is not the same gate.

**A prose-only node gets no right side at all**, rather than an empty frame apologising for itself.

The divider is the shared resizable-pane primitive, persisted like every other pane, so the split a reader
chooses is the split they get back.
