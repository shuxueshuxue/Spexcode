---
title: spec-view
status: active
hue: 195
desc: A spec node read as a full-width prose document, with governed files and attachments as links to their own file documents.
code:
  - spec-dashboard/src/SpecView.jsx
related:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/styles.css
---
# spec-view

A spec node opened as a **resident detail** at `#/spec/<id>`: its prose is the whole document surface, while
the workspace identity remains the top-level `#/spec` tab. Governed files and node
attachments remain in the prose's chip/link rows, but opening one navigates to its own `#/file/<path>`
document. SpecView never mounts a source reader and never chooses a file to show on first open.

**The prose renderer is the same pane the popup uses, not a second one.** A document and a popup showing
the same node must never be two implementations that can disagree about what the node says. The popup keeps
its place as a quick lens on board focus; this is where a node is READ.

Inline `[[id]]` references in that shared renderer are real detail anchors: they use the canonical
`#/spec/<id>` address, ordinary clicks focus the resident Spec tab, and Ctrl/Command-click uses [[tab-strip]]'s
`holdAnchor` gesture to keep a second document. The popup and both document panes therefore expose the same
working link, not a styled but inert span.

`code:` entries naming symbols resolve to file addresses — several entries can name the same file, but no
source face is embedded in the spec. A node's attachments ([[node-attachments]]) use the same chip row and
the same file-document address grammar. Attachments are still read through their node-owned API gate, not
through the governed-source policy; FileView supplies that alternate reader behind the address.

**The chips that open a file are the DOCUMENT'S OWN chips.** The prose already lists what the node governs
and carries, so the file is named once in the sentence that claims it. A click is ordinary navigation; tab
placement and whether the current slot is replaced or another kind is appended belong to [[tab-strip]]'s
tab model, not to SpecView. The resident Spec tab remains in the working set while focus moves to the file document.

**A prose-only node is the same full-width document**, with no empty source frame and no document split.

**The prose pane carries a selection layer.** Selecting a passage of the prose is enough to act on it —
send it to a session, or edit it in place and commit ([[prose-dispatch]]). That layer is mounted inside the
prose column and is made entirely of z-layers: the document's geometry with a selection is exactly its
geometry without one, and the chips are untouched by it.

**B5 acceptance.** A spec detail has no `.specview-code`, no automatic `SourceView`, and no split
divider or `spex.docSplit` state. Opening a governance chip or attachment produces an independent file tab,
leaves the spec tab in the working set, focuses the file, and lets a second chip replace the same file slot.
An alt-click on that file tab still sends it to the shell's second pane ([[tab-strip]]).
