---
title: archify
status: active
hue: 30
desc: SpexCode's vendored archify — the JSON-IR diagram renderers, validators, and viewer runtime that turn a node's diagram file into a page, carried as a dependency-free package because upstream is not on npm.
code:
  - packages/archify/package.json
related:
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

**One version, one build, one seam.** The package is lockstep with every other public package
([[release-publish]]) and has no build step. SpexCode calls it through its executable — `spex` resolves the
package's `bin/archify.mjs` by module resolution, never by PATH — so the renderer runs in one process shape
everywhere and the fork's internals stay private to it. It is a Node package: the dashboard never bundles
it, it receives rendered pages over the API.
