# Upstream

Vendored from https://github.com/tt-a1i/archify (MIT), commit `10722002bb8777ecb639d93c49586fae4adf3ae4` (2026-09-08,
"fix(viewer): embed the viewer font so delivered pages stay self-contained").

## What was taken
The render/validate runtime only: `bin/archify.mjs` (cut down — see below), `renderers/`, `schemas/`,
`assets/template.html` (the viewer), `migrations/` (workflow v1→v2), one example IR per diagram type (what
`doctor` checks), `scripts/check-render-output.mjs` (the artifact check every validate and deliver spawns),
`scripts/generate-validators.mjs` (to re-derive the validators after a schema change),
`LICENSE`, `THIRD_PARTY_NOTICES.md`. The runtime imports only `node:*` built-ins and its validators are
pre-generated, so the package carries no dependencies.

## What was left behind
The upstream test suite (it tests the upstream repository's docs, site, release identity and update
channel as much as the renderer; our regression is validate+deliver over the real diagram files),
`delta/` (architecture compare), `recipes/` and `references/` (the agent guide), `brand-marks/` and the
generated vendor-logo catalog, `bin/preview.mjs`, `bin/visual-check.mjs`, the rendered showcase pages,
benchmarks, experiments, docs, and the skill-update manifest.

## Local changes
- **Library face (`index.mjs`).** Upstream runs each step as its own process: `bin` spawns a renderer script,
  the script reads argv and writes the page, then `bin` spawns the checker script on that file. Here each of
  those scripts exports its logic as a function and keeps its script entry behind a main-module guard:
  `renderArchitecture`, `compileWorkflowDiagram`, `renderSequenceSvg`, `renderDataflowSvg`,
  `renderLifecycleSvg`, `checkRenderOutput`. `renderers/shared/cli.mjs` factors `prepareDiagram` (every
  pre-render check + source evidence) and `diagramPage` (template fill) out of the script head and tail.
  `renderers/shared/render-context.mjs` is the one seam for per-render options: the library passes quality
  explicitly for one synchronous call, the CLI still passes it through the environment. The checker's result
  → diagnostics conversion moved from `bin` to `renderers/shared/artifact-diagnostics.mjs`.
  Proof: 32 IRs (26 real diagrams, 1 hand lifecycle, 5 examples) — CLI output byte-identical before and after
  (render 32/32, validate 32/32, inspect 18/18); library output in one process byte-identical to the CLI
  baselines, forward and reverse order. `test/library.test.mjs` pins the example pages by sha256.
- **The shared viewer runtime.** The template's font face, stylesheet and viewer script carry no translated
  string and no per-diagram slot, so `runtimeAssets()` / `writeRuntime(dir)` emit them once, content-hashed,
  and `diagramHtml(parts, { runtime: { base } })` links them instead of inlining (≈ 85 KB per page instead
  of ≈ 800 KB). `runtime: 'inline'` (the default) is the CLI's self-contained page.
- **`bin/` is no longer the published surface** (no `bin` field; it is kept as the upstream-shaped
  development CLI and the byte-identity reference).
- `bin/archify.mjs`: the `compare`, `preview`, `visual-check`, `guide`, `brands`, `examples` and `demo`
  commands and their helpers are removed (74 KB → 45 KB); `doctor` no longer checks for the removed
  runtimes, references and compare fixtures. Kept: `render`, `deliver`, `validate`, `inspect`, `check`,
  `migrate`, `doctor`, `help`.
- `renderers/shared/generated-brand-marks.mjs`: the catalog is empty (`BRAND_MARKS = []`); the
  brand-marks API still answers, a component naming a `brand` simply gets no mark.
- `schemas/*.schema.json` + regenerated `renderers/shared/generated-validators.mjs`: one optional field,
  `meta.note` (string, ≤600 chars).
- `renderers/shared/cli.mjs` / `utils.mjs` / `assets/template.html`: `meta.note` is rendered as
  `<p class="diagram-note">` under the diagram, above the cards, visible in embed mode.
