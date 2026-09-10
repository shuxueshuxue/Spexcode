---
title: atlas-plugin
status: active
hue: 30
desc: The atlas skill packaged as a plugin that Claude Code and ZCode both install, generated from the same preset `spex init` seeds, with this repository as its marketplace.
code:
  - scripts/atlas-plugin.mjs
related:
  - plugins/atlas/.claude-plugin/plugin.json
  - plugins/atlas/.zcode-plugin/plugin.json
  - plugins/atlas/skills/atlas/SKILL.md
  - .claude-plugin/marketplace.json
  - .spec/spexcode/.plugins/skills/atlas/spec.md
  - scripts/sync-init-plugins.mjs
  - package.json
---

# atlas-plugin

The atlas skill — draw the spec tree's pictures with `spex diagram` ([[diagram-cli]]) — reaches an agent two ways.
Inside a repository SpexCode already governs it is a skill preset, seeded by `spex init` and materialized into
every harness's skill folder like every other `.plugins` skill. For everyone else it is a **plugin**: the unit
that Claude Code's and ZCode's plugin managers discover, install, enable and update.

**One package, both hosts.** `plugins/atlas/` is laid out as both hosts install a plugin: a manifest for each
(`.claude-plugin/plugin.json`, `.zcode-plugin/plugin.json`), and `skills/atlas/SKILL.md`. ZCode reads Claude Code's
plugin and marketplace formats directly; the ZCode manifest only makes its first-class loader's choice explicit.
The repository root carries `.claude-plugin/marketplace.json`, so the repository itself is the marketplace: add it
by its GitHub name in either host and install `atlas@spexcode`. A plugin in the same repository is named by a path
relative to that root, which both hosts resolve from a git or local-directory marketplace.

**Generated, never hand-edited.** The skill text has one source, the atlas preset in `.plugins`, read through the
same projection that writes the init templates — so the plugin says exactly what adopters are seeded. The plugin
adds only what a repository without SpexCode needs first: install `spex`, adopt the repository, read `spex guide
diagram`. The install line follows the version: while the line is a prerelease it installs `spexcode@next`, since
only that tag carries the diagram verbs. The manifests carry the repository's version, so a release bump
regenerates them. `npm run build:atlas-plugin` writes the files; `npm run lint` fails while they are stale, so a
preset edit or a version bump cannot ship a plugin that disagrees with it.

**Proof of installability is the hosts' own code.** The package must pass Claude Code's strict validator and
install through `claude plugin marketplace add` + `claude plugin install atlas@spexcode` into an isolated
configuration, and ZCode's marketplace module must add the marketplace, report no diagnostics, install it and
list `atlas` as a skill — the installed skill byte-identical to the one committed here. A trigger line is written
without inner quotes: ZCode's frontmatter reader keeps YAML escape sequences literally.

Getting the plugin into either vendor's official marketplace is a later, separate step; this repository is the
marketplace until then.
