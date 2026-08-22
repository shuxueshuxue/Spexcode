---
title: file-tree
status: active
hue: 205
desc: The left dock — a spec node is a folder, so the tree that navigates the project is the folder tree.
code:
  - spec-dashboard/src/FileTree.jsx
related:
  - spec-dashboard/src/Dashboard.jsx
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

**What a file opens into is a layer, not a second pane** ([[file-viewer]]). Two documents side by side is
not reachable yet: every page component reads the global route, so rendering two at once means changing all
of them to take a route instead. That is a real refactor with real risk, and naming it is better than a
half-split that works for one document type. The dock and the layer are useful without it, and the inline
expansion of a governed file under its spec ([[source-view]]) already covers the case the split was first
wanted for.

The dock is off by default and toggled from the status bar, where a workspace control belongs now that
[[status-bar]] exists. Its width is the shared resizable-pane primitive, persisted per pane like every other.
