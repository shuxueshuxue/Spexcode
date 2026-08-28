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
  - spec-dashboard/src/specTreeState.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/explorer-collapse-folders.e2e.mjs
---
# file-tree

The left dock. A spec node **is** a folder, so the tree that navigates the project is the folder tree: the
same shape on disk, on the board, and here.

**It is built from the board the app already holds, not from a new endpoint.** The node list carries
`parent` and `code:` — that is the whole hierarchy plus every governed file, already in memory. A tree route
would have been a second projection of the same data, free to disagree with the board about what exists.
Only a node's attachments are fetched, and only on the expand that reveals them, so a reader who never opens
a branch never pays for its folder listing.

**THE TREE IS A VIEW OF THE ADDRESS, so routing to a node opens the branch that holds it.** Its ANCESTORS
open, never the node itself: disclosure means "show me what is inside", and forcing that on arrival would
answer a question the reader did not ask and fight their own collapse of it. A route onto an already-visible
node changes nothing and costs no render.

**Disclosure is held OUTSIDE the rows that draw it, and it is remembered.** A row unmounts whenever an
ancestor collapses or the whole dock folds, so a row-local flag is erased by gestures that have nothing to
do with it — and, being unreachable from outside, it also left the tree unable to open the branch its own
address named: the explorer could sit on a closed root while that spec's document was open beside it. One
store outside the rows fixes both, and it is the same shape [[session-forest]]'s fold store already uses,
because it is the same problem twice. It persists, so the arrangement a reader made is still there on the
next boot; storage that refuses to answer yields an empty tree, which is a correct tree. The store holds
TWO ledgers — the open spec nodes and the open disk directories ([[disk-tree]]) — because the disk
projection had the first defect for as long as its folders kept row-local flags: closing the Files
section forgot every folder inside it.

**A row does both things.** Clicking a node focuses it on the board *and* discloses its contents. Splitting
those into two hit targets would make the common move — look inside this node — cost two clicks in a list
built for scanning.

**The graph is one click from the tree.** A graph entry at the tree's head opens the resident Spec tab at its
bare address, which both focuses the held tab and clears any node or file selector; merely restoring the
previous selector would leave the door looking inert whenever a concrete Spec document is already open.

**The disclosure mark is a thin chevron, and nesting is drawn as a line.** Every collapsible row — a node,
a directory, a section head, and the conversation's seams and tool rows ([[conversation]]) — wears
[[icon-system]]'s one `Caret`: a stroke chevron that turns a quarter to say "open", the grammar Obsidian's
file explorer and outliner read in (<https://docs.obsidian.md/Reference/CSS+variables/Components/Indentation+guides>),
rather than a filled triangle, which reads as a bullet. Beneath an open row, each nested level hangs from a
hairline indent guide dropped from the centre of its parent's caret slot at the divider weight (`--edge`):
rows are flat siblings, so each draws its own segment and the stack joins into one continuous line, and
a reader can see which branch a deep row belongs to without counting indents.

**Files keep the colours their chips have in the popup**, so a governed file and an attachment look the same
wherever they are listed rather than teaching the reader two vocabularies for one thing.

**A row opens a DOCUMENT, not a modal.** A node row opens its [[spec-view]]; a governed file row opens
[[file-view]], and an attachment row opens the same FileView through its `.spec/<node>/<name>` logical
address. The dock used to open a layer over the frame, because the frame had no content area to open
anything into — that limitation is gone with [[workspace-shell]], and with it the layer. Clicking here and
clicking a tab now reach the same place by the same address. Plain and ctrl/⌘ placement are the shared
[[tab-strip]] gestures; the tree does not carry a second tab policy.

**The tree names itself through the dock, not through a strip of its own.** "Explorer" and the node tally
live in [[dock-modes]]' single header row, because they describe the dock that is currently projecting the
explorer; a projection that re-declares its own name is a second answer to a question answered one row
above, and it cost a chrome band to give.

**The explorer shows TWO sections, and they are two projections of one project.** SPECS is this tree and FILES
is the disk listed as the disk ([[disk-tree]]). Both are always mounted and identified by static `.si-zone`
heads: a count pod, sentence-case label, and trailing hairline. There is no section-level disclosure state or
localStorage preference; only a spec node or disk directory can disclose its own children. The explorer head's
collapse-folders door still folds those child ledgers together, leaving both zone heads and their roots visible.

**Collapse folders is a door of the EXPLORER, not of a section.** One action folds every open folder in
both projections — every disclosed spec node and every disclosed disk directory — through the one store,
so it sits on the dock head the two sections share ([[dock-modes]]), beside search, and never on a section
head: a control nested beside "Specs" claims for that section an action that belongs to the list, and it
put a second button inside a disclosure row that already is one. This is the shape an editor's explorer
gives its collapse-all view action — on the view's title row, acting on folders and never on the view's
own sections — so the Specs and Files heads stay exactly as the reader left them, the roots stay listed,
and the route is untouched; a reader reopens one branch from its own row. While nothing is open the door
is disabled rather than hidden, so the head keeps one shape and the icon keeps one place.

The dock is ON by default — it is how a reader finds a document without already knowing its address, and a
workspace whose only entrance is a URL is a workspace nobody enters. Its explorer and sessions projections
are selected from the rail's activity-bar buttons ([[side-nav]], [[dock-modes]]). On by default is not beside
the content always: while a full-bleed board (Evals, Issues) is the routed document the dock does not render
at all ([[workspace-shell]]) — the preference stays on and the rail entry stays lit, because what the reader
chose is not what the board is doing. Its width is the shared resizable-pane primitive, persisted per pane
like every other.

## the row menu, and the one seam that serves both projections

A tree row's verbs were reachable only by a gesture a reader had to already know: ⌘/ctrl-click opens a row
in its own tab, and nothing announced it. A right-click is where a workspace is
asked what it can do with the thing under the cursor, so every explorer row answers one: a spec node offers
the same vocabulary it offers on the graph ([[node-graph]]'s node menu) — open in a new tab, reveal on the
graph, copy its link, copy its id — and a file offers open in a new tab, copy its link, copy its path, and
**reveal owning node** only when some node's `code:` actually claims that path. A directory offers the one
verb it has, because a folder is not a document ([[disk-tree]]).

The menu is wired ONCE, on the shared body both projections mount into. A row declares WHAT IT IS on its own
element (`data-menu-kind` with a node id or a path); the body's single right-click and keyboard handler reads
the subject off whichever row the event came from. So neither tree owns a menu, no row kind owns a handler,
and a row added later joins by naming its subject. The owning-node lookup needs no route either: the board
the tree is already built from carries every `code:` claim.

Both verbs are registry actions ([[keyboard-nav]]), never a second spelling here: `explorer.menu`
(⇧F10 / the context-menu key, the OS-universal gesture) opens the focused row's menu anchored to that row,
and `explorer.openInNewTab` holds the focused row in its own tab — the keyboard equal of the click gesture
that was previously unnamed. A keyboard opening borrows focus into the menu and gives it back to the row on
close; a pointer opening leaves focus exactly where it was ([[context-menu-chrome]]).
