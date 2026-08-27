---
title: disk-tree
status: active
hue: 205
desc: The explorer's ordinary-file projection — governed roots as a real directory tree, one level fetched per expand, closed until asked for.
code:
  - spec-dashboard/src/DiskTree.jsx
related:
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/tabs.js
  - spec-cli/src/source-list.ts
  - spec-dashboard/src/styles.css
---
# disk-tree

**On the name.** This node and [[file-tree]] are two projections of the same project, and the first pair of
names for them — `file-tree` and `files-tree` — differed by one letter, which the id-confusability rule
rightly refused: two ids a reader cannot tell apart are two ids that will be cited wrong. `disk-tree` says
which projection this is. The dock still labels the section **Files**, because that is what a reader is
looking for when they open it; the node is named for what it IS, the section for what it is FOR.

[[file-tree]] navigates the project the way the SPEC tree is shaped: a node is a folder, and a governed file
hangs off whichever node claims it. That is the right shape for the work this product is about, and it is
the wrong shape for the other thing a reader does constantly — **open a file whose location they already
know**. In the spec tree a path exists only if some node happens to claim it, so finding a particular file
means first knowing which node governs it. That is a question about the spec graph, asked by someone who
only wanted a file.

So this is the disk, listed as the disk: governed roots at the top, real directories under them, ordinary
code inside. Two projections of one project, each honest about which one it is — nothing here re-derives the
spec graph, and nothing there re-derives the filesystem.

**It reads [[source-list]] and nothing else.** The listing gate is the read gate, so every row this draws is
a row that opens; the browser never re-implements a policy and never has to guess whether a file it can see
is a file it can show.

**Which folders are open is the explorer's memory, not the row's.** A directory's disclosure is held in
the same store the spec tree keeps its own in ([[file-tree]]), persisted beside it: closing the Files
section unmounts every row, and while each row owned its flag that fold forgot every folder the reader had
opened. Held outside the rows, the arrangement survives the section fold and the dock fold alike, and the
explorer head's one collapse door folds these directories together with the spec branches instead of
knowing only half the list.

**A level per expand.** A branch fetches once, on the expand that reveals it, and keeps what it got —
re-opening is instant, and a reader who never opens a branch never pays for its listing. That is the same
bargain [[file-tree]]'s attachments make, and it keeps the cost of the tree proportional to what the reader
looks at rather than to how large the repository is. A failed listing is HELD as the failure it was: a
branch that cannot be read says why, rather than looking like a folder with nothing in it. A truncated
listing shows that it was truncated, because a client that cannot tell "this is everything" from "this is
the first 500" is showing the reader a lie.

**A directory only discloses; a file is a document.** There is no `#/dir/<path>` and there should not be
one — a folder has nothing to show — so clicking a directory opens its branch and changes no address. A file
row is a real anchor at `#/file/<path>` on the workspace's ordinary slot semantics ([[tab-strip]]): plain
click reads it in the current slot, ctrl/⌘ holds it as its own tab, through the same helper every other
anchor-row surface calls. It is the same address the node tree's governed-file rows open, because one file
has one address however the reader found it.

Its rows carry the same `data-menu-*` subject declaration the node tree's rows carry, and that is all they
carry: the row menu is the explorer's one seam ([[file-tree]]), so this projection grows no menu, no
right-click handler, and no second copy of the file vocabulary. A directory row declares itself a directory
and is offered only what a folder can answer.
