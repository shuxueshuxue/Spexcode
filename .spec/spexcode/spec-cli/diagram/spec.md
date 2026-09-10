---
title: diagram
status: active
hue: 30
desc: A spec node may carry one archify diagram of its own level — an IR file beside its spec.md that is the node's picture of its children, versioned with the spec, drawn by the backend and shown inline above the body.
code:
  - spec-cli/src/spec-diagram.ts
related:
  - packages/archify/index.mjs
  - spec-cli/src/index.ts
  - spec-cli/src/public-graph.ts
  - spec-cli/src/spec-attachments.ts
  - spec-dashboard/src/NodeDiagram.jsx
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
lint findings are to carry those three facts: `diagram-id` and `diagram-source` as errors, `diagram-stale` as
a warning. They are not built yet; until they are, nothing checks a diagram against the tree it projects.

**The IR is the truth; the picture is derived, by the backend, on read.** `diagram.*.json` is committed with
the spec it belongs to, in the same commit as the change it reflects; nothing rendered is ever tracked. When a
node's content is read, the backend renders its IR in-process through [[archify]]'s library into one SVG and
hands it out with the body: the live content endpoint and the published graph's per-node document carry the
same `diagram` field, so the two faces of the tree show the same picture by the same path. The reader draws the
picture only: the IR's cited sources are not verified on read — that takes the repository's origin, the pinned
commit and every cited file, an authoring check (`archify validate --repo-root`, and the lint findings above) —
and the SVG does not depend on them. So rendering is a pure function of the IR's text, reads no git, and is kept
per IR content for the life of the process: an unchanged diagram renders once, an edited one is a new key.

**A diagram that cannot be drawn says why, in its own slot.** Unknown type, invalid JSON, a schema or layout
violation (with archify's own diagnostics), more than one diagram file in a folder, or a renderer crash: each
comes back as `{ file, type, error, diagnostics }` instead of an SVG. It never costs the node its document —
the body is served either way.

**Shown inline, not in a viewer.** The dashboard puts the SVG straight into the node's page ([[node-diagram]]),
styled by archify's generated stylesheet and driven by its small browser module — no iframe, no viewer script,
no renderer in the bundle. A click focuses a box: its neighbours stay lit, everything else dims, and the edges
it touches keep a pulse flowing from source to target. A double-click on a box whose id is one of this node's
children opens that child.

**Who draws it.** A person, or a cartographer agent handed the level's context — the node's body, its
children's excerpts, the relations folded between their subtrees — and told to choose the type on that
evidence, keep every card line grounded, and repair from archify's receipts until the validator is green.
What the agent learns about the spec while drawing (a claim the code does not bear out, a stale count) is
filed as an issue, not stored with the picture. The writer (`spex atlas`, which fills a node's folder from a
level's context) is the next step after the lint findings.
