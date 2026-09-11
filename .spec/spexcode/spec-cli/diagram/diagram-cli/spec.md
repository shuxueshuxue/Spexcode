---
title: diagram-cli
status: active
hue: 30
desc: The author's side of a node's diagram — `spex diagram scaffold` writes a diagram.json that already fits the tree, `spex diagram check` judges it the way everything downstream will until it passes.
code:
  - spec-cli/src/diagram-cli.ts
related:
  - spec-cli/src/diagram-cli.test.ts
  - spec-cli/src/lint.ts
  - spec-cli/src/guide.ts
  - spec-cli/src/help.ts
  - spec-cli/src/cli.ts
---

# diagram-cli

A node's diagram ([[diagram]]) is authored by whoever is told to draw it — often an agent that knows nothing
of how this product draws pictures. What it needs is on the command surface, not in anyone's memory:
`spex guide diagram` for the format and the loop ([[guide]]), and two verbs under the `diagram` noun
([[cli-surface]]). The noun belongs to the repo profile as well as the full one: drawing a node's picture is
repository work, like reading its spec.

**`spex diagram scaffold <node>` starts a file that is already right about the tree.** For an architecture
diagram — the default — it writes `<node folder>/diagram.json` with one box per direct child, the box id being
the child's node id, each box citing the child's `spec.md` and the file its node claims in `code:`, laid out on a
plain grid every box fits in. The parts an author gets wrong by hand — which ids, which paths — are written by
the tree itself, and the file passes `check` as written; what remains is the drawing: placement, labels, edges,
regions, cards, the note. Cited sources are evidence pinned to a commit of a public repository, so the scaffold
pins `HEAD` and names the origin's GitHub or Gitee URL; on any other origin it writes no sources at all rather
than evidence nothing can verify. It cites only files that exist at the commit it pins: a node created a minute ago
and not yet committed is still drawn, but uncited, and the receipt names what it left out and how to cite it
later — otherwise the scaffold would fail its own check. For the other four kinds the tree implies no content, so it writes archify's
own example of that kind under the node's title, to be rewritten. It never replaces an existing file without
`--force`, and it refuses an architecture diagram for a node without children.

**`spex diagram check <node>` is the downstream verdict, early.** It draws the file the way the dashboard does,
runs archify's final-artifact check — layout, readability at the profile's width, and the cited evidence
verified against this repository — and applies the two tree rules the commit gate applies, through the same
function [[spec-lint]] uses, so a diagram that passes `check` cannot then fail lint. Every problem is printed
with archify's own suggested fix, and the exit code stays non-zero until everything passes. `--html` writes the
full viewer page for a visual pass; `--json` prints the whole verdict.

An author's mistake — an unknown node, a missing file, a bad flag — is a message and exit 2. Anything else is a
bug and keeps its stack.
