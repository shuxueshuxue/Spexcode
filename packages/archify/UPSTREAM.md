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
