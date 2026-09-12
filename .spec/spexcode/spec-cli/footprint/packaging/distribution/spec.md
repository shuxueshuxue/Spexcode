---
title: distribution
status: active
hue: 30
desc: The atlas packaged in the format of each host that installs agent add-ons — Claude Code, ZCode, gugu, PenguinHarness — one folder per host under distribution/, generated from the same preset spex init seeds and run through npx with nothing installed.
code:
  - scripts/distribution.mjs
related:
  - distribution/README.md
  - distribution/claude-code/atlas/.claude-plugin/plugin.json
  - distribution/claude-code/atlas/skills/atlas/SKILL.md
  - distribution/zcode/atlas/.zcode-plugin/plugin.json
  - distribution/zcode/atlas/skills/atlas/SKILL.md
  - distribution/gugu/spexcode-atlas/manifest.json
  - distribution/gugu/spexcode-atlas/prompt.js
  - distribution/gugu/spexcode-atlas/archify.mjs
  - distribution/gugu/spexcode-atlas/focus.js
  - distribution/gugu/spexcode-atlas/diagram.css
  - distribution/penguin/use-spexcode/plugin.json
  - distribution/penguin/use-spexcode/package.json
  - distribution/penguin/use-spexcode/icon.svg
  - distribution/penguin/use-spexcode/skills/atlas/SKILL.md
  - scripts/distribution.test.mjs
  - .spec/spexcode/.plugins/skills/atlas/spec.md
  - scripts/sync-init-plugins.mjs
  - package.json
  - .github/workflows/ci.yml
---

# distribution

The atlas — read a repository into a spec tree, draw its pictures with `spex diagram` ([[diagram-cli]]), hand over
one browsable page ([[public-spec-graph]]) — reaches an agent two ways. Inside a repository SpexCode already
governs it is a skill preset, seeded by `spex init` and materialized into every harness's skill folder like every
other `.plugins` skill. Everywhere else it is a package in the format of the product the agent runs in, and those
packages live in `distribution/`, one folder per host. The name says what the folder is for: it is not SpexCode's
own plugin tree (that is `.plugins`), and none of it is loaded by SpexCode.

**One folder per host, in that host's own format.**

- `claude-code/atlas` — a Claude Code plugin: `.claude-plugin/plugin.json` and `skills/atlas/SKILL.md`.
- `zcode/atlas` — a ZCode plugin: `.zcode-plugin/plugin.json`, the same skill with a section for ZCode, and the
  dynamic workflow that section runs ([[zcode-atlas-workflow]]). A ZCode build without the `CreateWorkflow` tool
  (dynamic workflows are not in every release yet) gets the same job turn by turn from the skill's own steps, and
  the agent says which path it took. ZCode also reads Claude Code's format, but its package says something Claude
  Code's does not, so it is its own.
- `gugu/spexcode-atlas` — a gugu tab extension: a manifest, a page, and the tab that shows the workspace's spec
  tree with each node's diagram and starts an agent on the atlas ([[gugu-atlas-tab]]). gugu extends its interface,
  not its agents, so its package is a page rather than a skill.
- `penguin/use-spexcode` — a PenguinHarness library plugin: `plugin.json` with that library's dated version,
  bilingual descriptions and category, an `icon.svg`, the `package.json` its loader resolves, and the skill. The
  `use-` prefix is that library's rule for a plugin built around another product.

**No marketplace.** No folder is a store. Each package is the unit that gets submitted to its host's own store or
library later, and until then a person loads it from the folder: Claude Code with `--plugin-dir`, ZCode by
listing it in `plugins.dirs`, gugu's Install picker, and a copy into a PenguinHarness agent's `skills/`.

**Nothing installed, nothing configured.** Every package runs SpexCode through npx, and a repository without a
spec tree is seeded by `spex init --pure` — the skeleton verb that exists for exactly this: `.spec/spexcode.json`
and a root `spec.md`, no git hooks, no agent configuration, nothing outside `.spec/` ([[spex-init]]). The packages
say `--pure` rather than hand-writing that root, because the config it plants is what makes the tree self-describing:
without it `spex spec lint` falls back to built-in `governedRoots` that name SpexCode's own source directories, and
a foreign repository is told it governs nothing. Measured on a fresh home directory, that path leaves npm's own
package cache and, from `spex spec lint`, a history cache of a few kilobytes under `~/.spexcode/projects/`;
`spex init --harness none` would add about thirty seeded `.plugins` files, six git hooks and a project store. The page the skill ends with
needs the dashboard package too, and npx fetches it for that one command.

**Generated from one source, written by hand where a person decides.** `npm run build:distribution` writes every
manifest and every `SKILL.md` from the atlas preset in `.plugins`, read through the same projection that writes
the init templates, so each package says what adopters are seeded; it adds only the lines a repository without
SpexCode needs first and the line that hands over the page. Versions follow the repository's version, and while
that is a prerelease every command names npm's `next` tag, the only tag carrying these verbs. The gugu tab's
copies of archify — the renderer bundled for a browser, the focus module, the stylesheet — are generated from
`packages/archify` with a pinned esbuild, so they stay byte-for-byte what the dashboard draws. gugu's shelf parses
each `.js` file as a classic script, so the generated focus helper and prompt expose globals. Archify keeps its
top-level-await ESM bundle as `archify.mjs`; the classic tab page loads it with a local dynamic import. The tab
loads those helpers in order. `npm run lint` fails while any generated file is stale. The ZCode workflow and the
gugu tab's own page are written by hand and the generator never touches them.

**Proof is each host's own code.** `npm run test:distribution` renders every archify example and every committed
diagram through the gugu bundle and requires the same SVG the renderer gives, reads a folder tree through the
tab's reader, and checks that every file a package names exists. Beyond CI: the Claude Code package passes
`claude plugin validate --strict` and loads with `--plugin-dir`; ZCode's own plugin discovery loads the ZCode
package from `plugins.dirs` with no diagnostics and its workflow compiler accepts the script; gugu's manifest
schema accepts the tab's manifest; PenguinHarness's skill reader parses the skill.
