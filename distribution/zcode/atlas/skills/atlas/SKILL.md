---
name: atlas
description: "Use when the user wants the atlas of a repository or its spec tree — read the codebase into a SpexCode spec tree, draw its architecture diagrams and hand over a browsable page (提取 .spec、画架构图、做成可浏览网页), draw the atlas, 画规格图, give node X a diagram, diagram this subtree. For a whole repository it runs one dynamic workflow (turn by turn where ZCode has no CreateWorkflow); for a node or subtree it draws with spex diagram scaffold and check until each passes."
---

# atlas

## Before you start

This skill draws with SpexCode's command line and needs nothing installed or configured on this machine.

- Run SpexCode through npx: `npx -y -p spexcode@next spex <command>` (Node 22 or newer). Wherever a step below says
  `spex …`, run it that way; a `spex` already on the PATH works the same.
- A diagram draws one node of the repository's spec tree, the `.spec/` folder. If the repository has none,
  `spex init --pure` plants one and stops there: `.spec/spexcode.json` and a root `.spec/<project>/spec.md`, no
  hooks, no agent configuration, nothing outside `.spec/`. Then rewrite that root to describe THIS project and add
  one folder beside it per part worth a box, each with its own `spec.md` — a `title:` and a `code:` line naming
  the file it is about in the frontmatter, a sentence or two below. `spex guide spec` has the full file format.
  Use `--pure`, not a bare `spex init`: a bare one adopts the repository into SpexCode's whole workflow, which is
  not what drawing a picture asks for.
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

If this ZCode has no `CreateWorkflow` tool (dynamic workflows ship in newer builds), do the same job turn by turn
with the steps below: the setup above for a repository without `.spec/`, `spex spec lint` until it reports no
errors, then each picture worth drawing, checked until it passes. Tell the user this is the turn-by-turn path; a
ZCode build with dynamic workflows runs the same job in parallel.

Draw the spec tree's pictures: one `diagram.json` beside each node's `spec.md` that is worth one.
The format, the rules and the loop for a single diagram live in `spex guide diagram` — read it before drawing.
This skill is the campaign around that loop.

1. **Scope.** The user names one node, a subtree, or the whole tree. `spex graph` lists the tree;
   `spex spec search <topic>` finds a node by what it is about.
2. **Choose what deserves a picture.** A node whose body explains how its children fit together gets an
   architecture diagram of those children. A node whose body is a process, a protocol, a data path or a
   lifecycle gets that kind instead. Skip leaves with nothing to show, and nodes that already carry a
   `diagram.json` unless the user asked for a redraw. Say what you skipped and why.
3. **Draw each node.** Choose the order top-down, but the drawing itself is per-node and independent: one picture
   reads its own node's body and its children's titles, and writes one file, that node's `diagram.json`. Two nodes
   never write the same file, so where your harness can run sub-agents they may be drawn at the same time — one
   node per sub-agent, handed only that node's context: its body, its children's titles and descriptions, and
   these steps. Keep a batch small enough that you still read every result before dispatching the next; a node
   whose check will not pass is that node's problem and must not stall the others, and a node that defeats you is
   reported in step 6 rather than retried forever. A sub-agent draws and checks its one node and stops: it does
   not commit, does not lint the tree, and does not touch a node it was not given. Landing happens once, in
   step 5, by whoever is running the campaign.
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

The page names the project after `dashboard.title` in `.spec/spexcode.json`, and falls back to the name of the
directory it was run in. A scratch checkout called `repo` or `tmp` therefore publishes a page titled that, which
is wrong on the one artifact a person is meant to read. Set the title when the directory is not the project's name.

The page opens on the whole-tree overview, so a node's drawing is one click in. Say which node to open when you
hand it over, or the first thing the reader sees is a map rather than the picture they asked for.
