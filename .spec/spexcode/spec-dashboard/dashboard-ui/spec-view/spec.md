---
title: spec-view
status: active
hue: 195
desc: A spec node read as a full-width prose document, with governed files and attachments as links to their own file documents.
code:
  - spec-dashboard/src/SpecView.jsx
related:
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/NodeDiagram.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/spec-change-face.e2e.mjs
---
# spec-view

A spec node opened as a **resident detail** at `#/spec/<id>`: its prose is the whole document surface, while
the workspace identity remains the top-level `#/spec` tab. Governed files and node
attachments remain in the prose's chip/link rows, but opening one navigates to its own `#/file/<path>`
document. SpecView never mounts a source reader and never chooses a file to show on first open.

**The prose renderer is the same pane the popup uses, not a second one.** A document and a popup showing
the same node must never be two implementations that can disagree about what the node says. The popup keeps
its place as a quick lens on board focus; this is where a node is READ.

**The node opens like a page.** Its title is the one statement size the page spends ([[typography]]) with
no markdown `#` in front of it; its one-line description reads as a muted subtitle directly under it; and
the at-a-glance signals — the status word with its colour tick, the version, drift when
any, and the last editing session — sit in one property row above a hairline, as tints and plain text
rather than a boxed strip. The governed-file and attachment rows follow as labelled chip rows; a node that
carries a diagram shows it next, inline ([[node-diagram]]); and the prose begins under them without a rule of
its own.

Inline `[[id]]` references in that shared renderer are real detail anchors: they use the canonical
`#/spec/<id>` address, ordinary clicks focus the resident Spec tab, and Ctrl/Command-click uses [[tab-strip]]'s
`newTabAnchor` gesture to open a second document. The popup and both document panes therefore expose the same
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

**A node mid-change has a second face: its pending change.** When a live worktree is changing the node (an
overlay, [[worktree-linker]]), the document must be able to show that change, not only colour the graph tile
and the explorer row. Two entrances lead to one address, `#/spec/<id>?surface=diff`. The first is in the
property row: next to the status and version, a `git-compare` toggle counts the node's pending changes. The
second is the same `git-compare` toggle the session diff face puts in the tab row's document-actions slot
([[diff-document]], [[document-actions]]). The query is a face of the one spec tab, not a second tab
([[tab-strip]]), so entering or leaving the face replaces the URL, and both toggles show one pressed state.
On that face the title and property row stay, and everything under the hairline (chips, diagram, prose) is
replaced by the popup's own change pane ([[node-popup]]), so the two surfaces cannot show a change
differently. The pane has one section per worktree. Each section starts with the shared op mark, the session
that owns the worktree (a real link into that session, or the branch name when the session has no live row),
and whether the change is committed, followed by the change itself as a word-level redline.

The prose stays the default face, because a node's address has to mean the same thing whether or not someone
is editing it right now. The one exception is a node that only a worktree proposes (a ghost). It has no body
on the source-of-truth branch, so the change is all there is to read: its bare address shows the change face,
and there is no toggle leading back to an empty page. When the overlay dissolves because the change landed or
was discarded, the face says there is no pending change, and the toggle stays until the reader leaves, so
the reader is never left on a page with no way back.

**The prose pane carries a selection layer.** Selecting a passage of the prose is enough to act on it —
send it to a session, or edit it in place and commit ([[prose-dispatch]]). That layer is mounted inside the
prose column and is made entirely of z-layers: the document's geometry with a selection is exactly its
geometry without one, and the chips are untouched by it.

When no passage is selected, a plain-prose right-click still opens that same z-layer as a node action menu.
It can send the complete current node through the shared session composer and copy the node's canonical link;
links and controls retain their browser context menu. When a live worktree is currently changing this node,
that menu also carries the **crossing into it** — the same [[session-picker]] rows over the same shared
overlay join the graph's tile menu uses ([[node-menu]]) — so arriving here by an inline `[[id]]` reference
is a door and not a dead end. The node send uses the same selection-token transport as
passage dispatch, with the whole body as the addressed range, so recipients receive one consistent node
reference rather than a reader-only special case.

**B5 acceptance.** A spec detail has no `.specview-code`, no automatic `SourceView`, and no split
divider or `spex.docSplit` state. Opening a governance chip or attachment produces an independent file tab,
leaves the spec tab in the working set, focuses the file, and lets a second chip replace the same file slot.
An alt-click on that file tab still sends it to the shell's second pane ([[tab-strip]]).

**Change-face acceptance** (`spec-change-face.e2e.mjs`, a real session's worktree over an isolated backend).
A node the worktree edits opens on its prose, and the property row names one pending change. The toggle moves
to `?surface=diff` in the same single tab. There, the words the worktree inserted and removed are marked, and
none of the words its re-wrap only moved to another line are. The tab row's `git-compare` action is pressed,
and it leads back to the prose. A node the worktree adds opens straight on its change and has no toggle. The
popup's edit tab renders the same redline.
