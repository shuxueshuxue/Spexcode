---
title: archify
status: active
hue: 30
desc: SpexCode's vendored archify — the JSON-IR diagram renderers, validators, and viewer runtime that turn a node's diagram file into a page, carried as a dependency-free package because upstream is not on npm.
code:
  - packages/archify/index.mjs
related:
  - packages/archify/package.json
  - packages/archify/renderers/shared/render-context.mjs
  - packages/archify/renderers/shared/cli.mjs
  - packages/archify/test/library.test.mjs
  - packages/archify/bin/archify.mjs
  - packages/archify/UPSTREAM.md
  - packages/archify/schemas/common.schema.json
  - packages/archify/assets/template.html
  - packages/archify/scripts/check-render-output.mjs
  - scripts/release-publish.mjs
  - scripts/build-workspaces.mjs
---

# archify

`@spexcode/archify` is [archify](https://github.com/tt-a1i/archify) (MIT) vendored into this repository: the
renderer for five diagram types (architecture, workflow, sequence, dataflow, lifecycle), the schema
validators with their repair receipts, the delta comparer, and the viewer runtime — zoom, focus and
relationship highlighting, the semantic lens, the route probe, the animated main-path flow, themes, and an
embed mode that hides the page chrome. It is what draws a spec node's diagram ([[diagram]]).

**Why vendored rather than depended on.** Upstream is `private: true` and ships as a skill checked out from
GitHub. That channel is closed on at least one machine this product must run on (the MacBook reaches npm and
not GitHub), and a skill directory is not something a package manager can pin. The runtime, measured, imports
only `node:*` built-ins and its validators are pre-generated, so a 2.6 MB subset of the tree runs with no
dependencies at all. Vendoring turns an unreachable dependency into an ordinary one, and it makes the viewer
ours to tune — the focus behaviour and the edge flow are the parts a product wants to own.

**What is carried and what is not.** `bin/`, `renderers/`, `schemas/`, `assets/`, `brand-marks/`,
`migrations/`, one example IR per type, the artifact-check script every validate and deliver spawns, and the
validator generator. Left upstream: the upstream test suite (it tests that repository's docs, site and update
channel as much as the renderer; this fork's regression is validate+deliver over the real diagram files), the
compare runtime, the agent guide and recipes, the vendor-logo catalog, the preview and visual-check tools, the
rendered showcase pages, benchmarks, experiments, docs, and the skill-update manifest. The CLI keeps eight
commands — render, deliver, validate, inspect, check, migrate, doctor, help — and loses seven. `UPSTREAM.md` names the commit and the cut so
a later sync has a baseline; every local change is listed there.

**One schema extension.** `meta.note` — an optional string on every diagram type — is the only field this
fork adds. It carries the author's short note under the diagram (what was folded, which relation is an
inference); everything else in the schemas stays exactly as strict as upstream, and the generated validators
are re-derived from the schemas rather than edited. An IR that uses `note` is one field away from upstream
compatibility; a consumer handing IRs to upstream tooling strips it.

**A library, not a set of scripts.** Upstream runs every step as its own process — the CLI spawns a
renderer script that reads argv and writes a file, then spawns a checker script on that file. Here each of
those scripts exports its logic as a function, and `@spexcode/archify` is that set of functions:
`renderDiagram(type, ir, {quality, repoRoot})` returns the page parts, `checkDiagram` renders and runs the
final-artifact check and reports problems as data (`ok`, `diagnostics` in the renderers' own vocabulary),
`layoutReport` gives the receipt a cartographer repairs from, and `diagramHtml(parts, {runtime})` assembles a
page. A diagram problem is a `DiagramError` carrying diagnostics, never a process exit. SpexCode imports these;
nothing in SpexCode spawns an archify process. The upstream-shaped CLI stays in the package as a development
tool and as the reference the library is proven against — the library reproduces its output byte for byte.

**One seam for options.** A renderer reads its per-render options — the quality profile above all — through one
module. The library sets them explicitly for one synchronous call; the CLI still passes them through the
environment of its child process. Neither path knows about the other, and the library never touches
`process.env`.

**The viewer is shared, the diagram is not.** A page is the viewer (font face, stylesheet, script: ≈ 716 KB)
plus one diagram (SVG, cards, note: tens of KB). The viewer carries no translated text and no per-diagram slot,
so a site of many diagrams ships it once, content-hashed, and each page links it (≈ 85 KB a page); a
self-contained page inlines it. Which to use is the caller's layout decision, not the renderer's.

**One version, one build.** The package is lockstep with every other public package ([[release-publish]]) and
has no build step. Its test renders every example in-process and compares each page to the sha256 of the page
the CLI produced, checks that a broken IR comes back as diagnostics, that a linked page carries no viewer code,
and that the generated validators match the schemas.
