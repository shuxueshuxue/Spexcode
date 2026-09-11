---
name: atlas
description: "Use when the user wants the atlas of a repository or its spec tree — read the codebase into a SpexCode spec tree, draw its architecture diagrams and hand over a browsable page (提取 .spec、画架构图、做成可浏览网页), draw the atlas, 画规格图, give node X a diagram, diagram this subtree. For a whole repository it runs one dynamic workflow; for a node or subtree it draws with spex diagram scaffold and check until each passes."
---

# atlas

## Before you start

This skill draws with SpexCode's command line and needs nothing installed or configured on this machine.

- Run SpexCode through npx: `npx -y -p spexcode@next spex <command>` (Node 22 or newer). Wherever a step below says
  `spex …`, run it that way; a `spex` already on the PATH works the same.
- A diagram draws one node of the repository's spec tree, the `.spec/` folder. If the repository has none, write
  only what the drawing needs: `.spec/<project>/spec.md` describing the project, and one folder beside it per part
  worth a box, each with its own `spec.md` — a `title:` and a `code:` line naming the file it is about in the
  frontmatter, a sentence or two below. That is the whole setup: no `spex init`, no hooks, no agent configuration.
  `spex guide spec` has the full file format if you need more.
- `spex guide diagram` is the manual for the diagram format and the loop; read it once.

## In ZCode: the whole repository as one dynamic workflow

When the job is a whole repository — read it into a spec tree, draw its pictures, hand over a page to browse
(提取 .spec、画架构图、做成可浏览网页) — do not work through it turn by turn: run it as one dynamic workflow.
`${ZCODE_SKILL_DIR}/atlas.dwf.ts` is that workflow, already written and checked by the workflow compiler.

1. Read the script. Set `LANGUAGE` to the language the user is speaking and rewrite each `phase("...")` name into
   that language. Change nothing else.
2. Submit it with the `CreateWorkflow` tool as its `script` — not the legacy `Workflow` tool, not `Agent`.
3. The run surveys the repository and writes the spec for each part in parallel; gates on `spex spec lint` until it
   reports no errors and 90% coverage; chooses the nodes worth a picture, draws them in parallel and gates each on
   `spex diagram check`; has an independent reader check the top of the tree against the code; commits `.spec/`;
   and publishes the page as its `atlas` artifact, with a report beside it.
4. When it finishes, relay the report: coverage, which pictures pass, what was skipped and why, and every claim the
   reader found the code does not bear out. If a subagent escalates, answer it, or fix the script and resubmit with
   `resume_from` — the `dynamic-workflows` skill has both.

A repository that already has a `.spec/` tree keeps it: the workflow skips the survey and starts at the gate. For
one node or one subtree the steps below are enough; the workflow is for the whole job.

Draw the spec tree's pictures: one `diagram.json` beside each node's `spec.md` that is worth one.
The format, the rules and the loop for a single diagram live in `spex guide diagram` — read it before drawing.
This skill is the campaign around that loop.

1. **Scope.** The user names one node, a subtree, or the whole tree. `spex graph` lists the tree;
   `spex spec search <topic>` finds a node by what it is about.
2. **Choose what deserves a picture.** A node whose body explains how its children fit together gets an
   architecture diagram of those children. A node whose body is a process, a protocol, a data path or a
   lifecycle gets that kind instead. Skip leaves with nothing to show, and nodes that already carry a
   `diagram.json` unless the user asked for a redraw. Say what you skipped and why.
3. **Draw each node.** Go top-down, one node at a time; if your harness can run sub-agents, give each node to its
   own, handing it only that node's context — its body, its children's titles and descriptions, and these steps.
   For one node:
   - read its `spec.md` and its children's, and choose the kind from what the body spends its words on;
   - `spex diagram scaffold <node>` (add `--type <kind>` for anything but architecture);
   - draw: place the boxes, connect what the body says is connected and name each edge by what crosses it,
     group with regions, add cards, and write `meta.note` — what was folded, which relation is an inference;
   - `spex diagram check <node>`, and repair from its findings until it passes.
   Put no numbers on a picture that move on their own — node counts, drift, commit or import counts.
4. **Keep the spec honest.** What drawing reveals about the spec — a claim the code does not bear out, a
   relation the body never states — goes into an issue or your report, never into the picture.
5. **Land it.** `spex spec lint`, then commit the diagrams, together with any spec change they belong to.
6. **Report** which nodes got which kind of diagram, which were skipped and why, and anything you filed.

## Hand over the page

`npx -y -p spexcode@next -p @spexcode/spec-dashboard@next spex graph --public --html spexcode-atlas.html` writes the whole tree — every body and
every picture — as one self-contained page that opens in any browser, straight from disk. Offer it with the report;
it is a product of the tree, not part of it, so leave it uncommitted.
