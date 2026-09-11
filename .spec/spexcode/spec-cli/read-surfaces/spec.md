---
title: read surfaces
hue: 190
desc: The faces a reader looks through at the derived tree and what it governs — the whole graph (live over HTTP, as a terminal tree, as a static publish), finding a node, and opening one down to the files it carries and governs. Each is a projection, never a second source.
---
# read-surfaces

[[source-of-truth]] defines what there is to read — the spec tree with each node's derived version, drift and
status, and the set of source files that tree governs — and [[sessions]] assembles the live board from it.
These nodes are the faces a reader looks through, one per question a reader brings:

- *What does the whole tree look like?* The dashboard's live graph over HTTP ([[graph-delivery]]), the same
  board as a terminal tree ([[spex-tree]]), and a static publish of one revision that needs no backend
  ([[public-spec-graph]]).
- *Which node answers my question?* [[spec-search]].
- *What does this node carry?* Its folder and its picture ([[node-attachments]]), and the source it governs
  ([[source-read]]).

They share one contract: a face is a projection, never a second source. None keeps its own copy of the
tree, and whatever a face holds between requests is keyed on exactly what it was computed from — a board
build invalidated on change, a diagram's IR text, a publish pinned to one revision — so it cannot answer with
anything the tree would not. Two faces of one fact give one answer: the terminal tree and the dashboard draw
the same board, and a surface lists only what it can open.
