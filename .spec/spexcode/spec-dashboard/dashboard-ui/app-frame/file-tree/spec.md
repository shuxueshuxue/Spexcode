---
title: file-tree
status: active
hue: 205
desc: The left dock — a spec node is a folder, so the tree that navigates the project is the folder tree.
code:
  - spec-dashboard/src/FileTree.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/useResizable.js
  - spec-dashboard/src/styles.css
---
# file-tree

The left dock. A spec node **is** a folder, so the tree that navigates the project is the folder tree: the
same shape on disk, on the board, and here.

**It is built from the board the app already holds, not from a new endpoint.** The node list carries
`parent` and `code:` — that is the whole hierarchy plus every governed file, already in memory. A tree route
would have been a second projection of the same data, free to disagree with the board about what exists.
Only a node's attachments are fetched, and only on the expand that reveals them, so a reader who never opens
a branch never pays for its folder listing.

**A row does both things.** Clicking a node focuses it on the board *and* discloses its contents. Splitting
those into two hit targets would make the common move — look inside this node — cost two clicks in a list
built for scanning.

**Files keep the colours their chips have in the popup**, so a governed file and an attachment look the same
wherever they are listed rather than teaching the reader two vocabularies for one thing.

**A row opens a DOCUMENT, not a modal.** A node row opens its [[spec-view]]; a governed file row opens
[[file-view]]. The dock used to open a layer over the frame, because the frame had no content area to open
anything into — that limitation is gone with [[workspace-shell]], and with it the layer. Clicking here and
clicking a tab now reach the same place by the same address.

The dock is off by default and toggled from the status bar, where a workspace control belongs now that
[[status-bar]] exists. Its width is the shared resizable-pane primitive, persisted per pane like every other.
