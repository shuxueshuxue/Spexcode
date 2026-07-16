---
title: spex graph (tree render)
status: active
hue: 200
desc: The CLI's human-readable graph view — the assembled board as an indented, status-coloured terminal tree with drift/stale-eval/open-issues badges.
code:
  - spec-cli/src/tree.ts#renderTree
  - spec-cli/src/tree.ts#treeJson
---
# spex-tree

The graph is the product's core mental object, and until now only the dashboard rendered it — a
pure-CLI user had `spex graph --json`'s raw payload and no way to *see* the tree. Bare `spex graph` closes that gap:
the SAME assembled board the dashboard's tidy-tree draws (merged tree + overlay + eval fold, via
`buildBoard()` — no new read path, so CLI and dashboard can never disagree about the graph), printed
as an indented terminal tree, one node per line: id, derived status, title, and the attention
badges the dashboard puts on a node — drifted-file count, stale-eval count (declared scenarios
whose latest reading has aged), and open-issue count. A ghost node (being added by a worktree)
says so.

Scope and shape follow the dashboard's own drill-down: `--node <id>` renders one subtree (an
unknown id fails loud and names the recovery — never an empty tree), `--depth N` limits levels
below the shown root and *says* how many children were pruned, and `--json` keeps the machine exit —
the same filtered subtree as nested objects with the badge counts precomputed (a shaped view;
`spex graph --json` remains the full flat payload).

Colour is reinforcement, never the signal: statuses map to the dashboard palette (green merged,
cyan active, warning-yellow drift, muted pending). Status labelling follows a **base-state law —
the ground state is invisible, only deviation gets a label**: `merged` is the healthy done-state of
the vast majority of nodes, already carried by the dot's colour, so a coloured tree prints no
`[merged]` text (a bare node *is* merged) and labels only the deviations (`active`, `pending`,
drift). When colour is absent (`NO_COLOR` or a non-tty pipe) the text label is the only signal
left, so every status word — merged included — prints and the tree degrades to plain text with
nothing lost. Badges (drift/stale/issues counts) are unaffected by the law.

The verb lives in the *find & read the graph* group of `spex help`'s map ([[cli-surface]]);
`tree.ts` is the verb's own module, `cli.ts` stays the thin dispatch hub.
