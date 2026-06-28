---
title: regroup
surface: command
status: active
hue: 130
desc: Resolve a node's breadth — a flat fan-out of too many children — by lifting children onto their true owner or a new grouping layer, only along real seams.
kind: mutating
---
A node flagged for **breadth** has too many direct children: a flat fan-out the eye can't hold. Breadth is altitude's structural twin — the same comprehensibility limit, rotated from a body's depth onto the tree's width. Find the **natural seams** in the fan-out and lift the children onto them, *only where a real group exists*. Getting under the child budget is the floor, not the goal; never manufacture structure to hit a number.

{{targets}}

Read before you move: the over-broad node's spec, every child's spec, and the `[[links]]`/`related:` between them. A flat fan-out is rarely one undifferentiated list — some children are **misfiled** under the wrong parent, some **cohere into a surface no node owns yet**, and some are **genuine independent peers**. Sort each child into exactly one disposition:

- **Reparent under an existing sibling.** When a child's own spec says it is *part of* another child — its tab, its row, its input, a sub-surface of it — that sibling is its true owner. `git mv` it under that node. No new parent: the breadth was the symptom of a misparented child, and putting it under its real owner fixes the miscategorization for free. **Try this first** — it is the cheapest, most honest move and adds nothing to the tree. (Second-order case: if a reparent pushes the new host over budget, that host now needs its own seam.)
- **Group under a new intermediate parent.** When several children genuinely cohere — one surface, one concept, read together to understand one thing — but no existing node owns them. Create one parent along that seam. It must **earn its existence**: a body stating what the group *is* and why these children belong, a contract at altitude (it is a real node and must pass altitude lint itself) — never a hollow container echoing a table of contents. The two-for-one test: a true seam also makes the siblings around it read more clearly.
- **Leave it flat.** When a child shares no boundary with the rest. A flat list of genuine peers is sometimes right; refusing to force a "misc"/"everything-else" bucket is the correct move, not a failure. A couple of real groups plus a handful of still-flat peers is a good outcome.

Honor these:

- **Reparent, never rewrite.** Move a node by `git mv`-ing its folder; its id (= folder basename), its `[[links]]`, its `code:` governance, and its `yatsu.md` all ride along untouched. If a child needs its body edited to belong in a group, it doesn't belong.
- **Fewest, deepest-justified parents.** Don't trade one flat layer for six two-child wrappers — that relocates the sprawl instead of resolving it. Between two passing groupings, take the one that adds fewer nodes.
- Parent ids name the concept (kebab-case); give the parent a `hue` near its children's family.

Work the order: (1) read everything; (2) write each candidate seam with the one-sentence intent that justifies it — kill the unjustifiable, and mark each survivor as reparent-under-existing or new-parent; (3) make the moves, one reviewable commit per group (`spec: <parent> — regroup <children>`, with a `Session:` trailer); (4) run `spex lint` and confirm breadth is resolved with no new errors. Uncommitted `git mv`s churn the drift count transiently — committing settles it; don't chase it.
