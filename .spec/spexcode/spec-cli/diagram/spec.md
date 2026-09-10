---
title: diagram
status: pending
hue: 30
desc: A spec node may carry one archify diagram of its own level — an IR file beside its spec.md that is the node's picture of its children, versioned with the spec, rendered on demand, and judged against the tree it projects.
related:
  - packages/archify/package.json
  - spec-cli/src/spec-attachments.ts
---

# diagram

A spec node is a folder ([[node-attachments]]); its document is `spec.md`. A node that is worth a picture
carries one beside it: **`diagram.<type>.json`**, where `<type>` is one of archify's five —
`architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle` ([[archify]]). One diagram per node.
The file is the archify IR verbatim — components, connections, boundaries, cards, `meta.repository.revision`,
`components[].sources` — plus one optional string, `meta.note`: the author's short line under the picture
(what was folded, which relation is an inference). Nothing else is invented: the IR already carries the
revision it was drawn at and the spec and code paths it was drawn from.

**The diagram is a projection of the tree, not a free canvas.** An `architecture` diagram's components are
the node's direct children (their ids are the node ids; small ones may fold into one `others` box). Every
source path it cites is a spec path in the tree or a file some node's `code:` governs. And the diagram is
drawn at a revision: when the node's children or their governed files change after that revision, the
picture may be stale — the same reading, derived live from git, that [[spec-lint]] gives code drift. Three
lint findings carry those three facts: `diagram-id` and `diagram-source` are errors, `diagram-stale` is a
warning.

**The IR is the truth; the page is derived.** `diagram.*.json` is committed with the spec it belongs to, in
the same commit as the change it reflects. The rendered page is never tracked: the CLI renders it on demand
through [[archify]] — validated, sources checked, delivered — and caches it under the project's own store
keyed by the IR's content and the revision, so an unchanged diagram renders once. The dashboard embeds that
page above the node's body in archify's embed mode (page chrome hidden; zoom, focus, the semantic lens and
the animated main path kept) and bridges its clicks back into the tree: a click selects that child, a
double-click descends to its level. The public graph ships the same rendered pages beside the documents.

**Who draws it.** A person, or a cartographer agent handed the level's context — the node's body, its
children's excerpts, the relations folded between their subtrees — and told to choose the type on that
evidence, keep every card line grounded, and repair from archify's receipts until the validator is green.
What the agent learns about the spec while drawing (a claim the code does not bear out, a stale count) is
filed as an issue, not stored with the picture.

This node names the contract. The reader path (the render endpoint, the dashboard slot, the click bridge),
the three lint findings, and the writer (`spex atlas`, which fills a node's folder from a level's context)
are the next steps and will claim their code here as they land.
