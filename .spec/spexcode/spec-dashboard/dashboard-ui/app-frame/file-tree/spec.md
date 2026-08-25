---
title: file-tree
status: active
hue: 205
desc: The left dock — a spec node is a folder, so the tree that navigates the project is the folder tree.
code:
  - spec-dashboard/src/FileTree.jsx
related:
  - spec-dashboard/src/DiskTree.jsx
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

**The graph is one click from the tree.** A graph entry at the tree's head opens the resident Spec tab at its
bare address, which both focuses the held tab and clears any node or file selector; merely restoring the
previous selector would leave the door looking inert whenever a concrete Spec document is already open.

**Files keep the colours their chips have in the popup**, so a governed file and an attachment look the same
wherever they are listed rather than teaching the reader two vocabularies for one thing.

**A row opens a DOCUMENT, not a modal.** A node row opens its [[spec-view]]; a governed file row opens
[[file-view]], and an attachment row opens the same FileView through its `.spec/<node>/<name>` logical
address. The dock used to open a layer over the frame, because the frame had no content area to open
anything into — that limitation is gone with [[workspace-shell]], and with it the layer. Clicking here and
clicking a tab now reach the same place by the same address. Plain, ctrl/⌘, and double-click placement are
the shared [[tab-strip]] gestures; the tree does not carry a second tab policy.

**The tree names itself through the dock, not through a strip of its own.** "Explorer" and the node tally
live in [[dock-modes]]' single header row, because they describe the dock that is currently projecting the
explorer; a projection that re-declares its own name is a second answer to a question answered one row
above, and it cost a chrome band to give.

**The explorer discloses TWO sections, and they are two projections of one project.** SPECS is this tree —
open by default, because it is the explorer's main body rather than one option among two. FILES is the disk
listed as the disk ([[disk-tree]]) — closed by default, because it answers a question this tree cannot: a
path exists here only if some node claims it, so a reader who knows where a file lives but not which node
governs it has nowhere to look. Closed also means unmounted, so a reader who never opens it never costs the
backend a listing.

A section head is NOT a band, and the distinction is structural rather than a matter of taste about
thickness: each is a `<section>` whose head owns its own disclosure control, so it scrolls inside the list
it heads instead of standing between the window edge and the content ([[ui-state-model]]'s classifier reads
exactly that shape). The dock therefore stays one band however many projections it discloses. The heads
borrow [[dock-modes]]' header register — muted meta, the name in ink at medium weight, **sentence case** —
because an all-caps tracked label is decoration wearing the costume of hierarchy ([[typography]]), and the
collapsed state of each is a localStorage preference like every other pane's.

The dock is ON by default — it is how a reader finds a document without already knowing its address, and a
workspace whose only entrance is a URL is a workspace nobody enters. Its explorer and sessions projections
are selected from the rail's activity-bar buttons ([[side-nav]], [[dock-modes]]). On by default is not beside
the content always: while a full-bleed board (Evals, Issues) is the routed document the dock does not render
at all ([[workspace-shell]]) — the preference stays on and the rail entry stays lit, because what the reader
chose is not what the board is doing. Its width is the shared resizable-pane primitive, persisted per pane
like every other.
