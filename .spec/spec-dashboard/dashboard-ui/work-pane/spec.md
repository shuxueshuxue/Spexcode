---
title: work-pane
status: active
session: sess-merge
hue: 335
desc: Spec and terminal are one surface — intent (left) beside the live session (right).
---
# work-pane

The spec tab and terminal tab were the same act split in two: the spec is the
*intent*, the terminal is where you *change it in place*. Toggling between them
meant you could never read the ground truth while driving the session.

Merge them into one `work` pane, two columns. Spec left (reference — read);
terminal right (the work surface, needs the rows/cols). Tabs drop 4 -> 3
(work / evidence / history); the terminal owns the keyboard while the work pane is
open, Tab cycles panes, Esc returns to the graph.

## v2 — wider spec
34/66 cramped the spec text. Widened the split to 40/60 — the spec stays readable
while the terminal keeps the larger share.
