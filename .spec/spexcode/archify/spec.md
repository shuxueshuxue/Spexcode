---
title: archify
status: active
hue: 30
desc: SpexCode's vendored archify — the JSON-IR diagram renderers and validators that draw a node's diagram, plus the generated stylesheet and small browser module that show it inline — carried as a dependency-free package because upstream is not on npm.
code:
  - packages/archify/index.mjs
related:
  - packages/archify/package.json
  - packages/archify/browser.mjs
  - packages/archify/assets/diagram.css
  - packages/archify/scripts/generate-diagram-css.mjs
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
validators with their repair receipts, and the viewer page the upstream CLI delivers — zoom, focus and
relationship highlighting, the semantic lens, the route probe, themes. It is what draws a spec node's diagram
([[diagram]]); SpexCode itself shows that diagram inline, with the browser half described below, not in the
viewer.

**Why vendored rather than depended on.** Upstream is `private: true` and ships as a skill checked out from
GitHub. That channel is closed on at least one machine this product must run on (the MacBook reaches npm and
not GitHub), and a skill directory is not something a package manager can pin. The runtime, measured, imports
only `node:*` built-ins and its validators are pre-generated, so a 2 MB subset of the tree runs with no
dependencies at all. Vendoring turns an unreachable dependency into an ordinary one, and it makes the diagram's
look ours to tune — the focus behaviour and the edge flow are the parts a product wants to own.

**What is carried and what is not.** `bin/`, `renderers/`, `schemas/`, `assets/`, `migrations/`, one example IR
per type, the artifact-check script every validate and deliver spawns, and the two generators (validators,
diagram stylesheet). Left upstream: the upstream test suite (it tests that repository's docs, site and update
channel as much as the renderer), the delta comparer, the agent guide and recipes, the vendor-logo catalog
(brand marks resolve to none), the preview and visual-check tools, the rendered showcase pages, benchmarks,
experiments, docs, and the skill-update manifest. The CLI keeps eight commands — render, deliver, validate,
inspect, check, migrate, doctor, help — and loses seven. `UPSTREAM.md` names the commit and the cut so a later
sync has a baseline; every local change is listed there.

**One schema extension.** `meta.note` — an optional string on every diagram type — is the only field this
fork adds. It carries the author's short note under the diagram (what was folded, which relation is an
inference); everything else in the schemas stays exactly as strict as upstream, and the generated validators
are re-derived from the schemas rather than edited. An IR that uses `note` is one field away from upstream
compatibility; a consumer handing IRs to upstream tooling strips it.

**A library, not a set of scripts.** Upstream runs every step as its own process — the CLI spawns a
renderer script that reads argv and writes a file, then spawns a checker script on that file. Here each of
those scripts exports its logic as a function, and `@spexcode/archify` is that set of functions:
`renderDiagram(type, ir, {quality, repoRoot})` returns the SVG and the page parts, `checkDiagram` renders and
runs the final-artifact check and reports problems as data (`ok`, `diagnostics` in the renderers' own
vocabulary), `layoutReport` gives the receipt a cartographer repairs from, and `diagramHtml(parts)` assembles
the self-contained page the CLI delivers. A diagram problem is a `DiagramError` carrying diagnostics, never a
process exit. SpexCode imports these; nothing in SpexCode spawns an archify process. The upstream-shaped CLI
stays in the package as a development tool and as the reference the library is proven against — the library
reproduces its output byte for byte. Type declarations describe the library for TypeScript callers; the
renderers stay JavaScript.

**One seam for options.** A renderer reads its per-render options — the quality profile above all — through one
module. The library sets them explicitly for one synchronous call; the CLI still passes them through the
environment of its child process. Neither path knows about the other, and the library never touches
`process.env`.

**The browser half: a stylesheet and a module, not the viewer.** The rendered SVG is inert and self-describing —
its boxes carry `data-node-id`, its edges `data-edge-from`/`data-edge-to`, and every colour, line and state is a
class or an attribute that CSS styles. So showing a diagram needs the viewer's styles for the SVG, not the
viewer. `assets/diagram.css` is those styles, generated from the viewer's stylesheet by a committed script (a
template sync is a re-run; the test fails when the file is stale):

- every rule is scoped under one host box, `.archify`, and the viewer's page root and diagram container both
  collapse into it, so no rule reaches the host page;
- only states a host can reach are kept — the box's detail level (`read` is the viewer's default: fine labels
  wait for hover or focus) and the svg's focus; rules that need the viewer script's other states (lens, route,
  story, chapters, presentation, the ambient trace animation) could never match and are left out;
- the palette follows the host's `color-scheme`: every variable that differs between the viewer's two themes
  becomes `light-dark(light, dark)`, a preset's variable falling back to the base theme's as it does in the
  viewer, and `data-theme` on the box pins one;
- the box takes the viewer page body's typeface and canvas colour.

`browser.mjs`, an import-free module, carries the two things a host does with an inline diagram.
`scopeIds(svgText, prefix)` prefixes every id the SVG defines and every reference to one: all rendered SVGs share
fixed ids (`#arrowhead`, `#grid`), a `url(#…)` resolves to the first element with that id in the document, and a
hidden earlier copy would take a visible diagram's arrowheads with it. `focusDiagram(svg, id)` focuses a box —
it and its direct neighbours stay lit, the rest dims — and lays a pulse along every edge touching it, the viewer's
own relationship pulse looped for as long as the focus holds; `null` clears it. Measured over the atlas's 26
diagrams in both themes, every SVG element's computed style inline matches the viewer's at rest; after a click,
the only differences are the fine labels the viewer reveals by zooming its camera in, which an inline host
does not do.

**One version, one build.** The package is lockstep with every other public package ([[release-publish]]) and
has no build step. Its test renders every example in-process and compares each page to the sha256 of the page
the CLI produced, checks that a broken IR comes back as diagnostics, that the diagram stylesheet is fresh and
every rule stays inside the box, that scoped ids leave no dangling reference, and that the generated validators
match the schemas.
