---
title: distribution
status: active
hue: 30
desc: The atlas packaged in the format of each host that installs agent add-ons — Claude Code, Codex, ZCode, gugu, PenguinHarness — one folder per host under distribution/, generated from the same preset spex init seeds and run through npx with nothing installed.
code:
  - scripts/distribution.mjs
related:
  - distribution/README.md
  - distribution/claude-code/atlas/.claude-plugin/plugin.json
  - distribution/claude-code/atlas/skills/atlas/SKILL.md
  - distribution/zcode/atlas/.zcode-plugin/plugin.json
  - distribution/zcode/atlas/skills/atlas/SKILL.md
  - distribution/gugu/spexcode/manifest.json
  - distribution/gugu/spexcode/prompt.js
  - distribution/gugu/spexcode/archify.mjs
  - distribution/gugu/spexcode/focus.js
  - distribution/gugu/spexcode/diagram.css
  - distribution/gugu/spexcode/spex-command.js
  - distribution/gugu/spexcode/skills/spexcode/SKILL.md
  - distribution/penguin/use-spexcode/plugin.json
  - distribution/penguin/use-spexcode/package.json
  - distribution/penguin/use-spexcode/icon.svg
  - distribution/penguin/use-spexcode/skills/atlas/SKILL.md
  - scripts/distribution.test.mjs
  - .spec/spexcode/.plugins/skills/atlas/spec.md
  - scripts/check-init-plugins.mjs
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
- Claude Code exposes that skill as the native `/atlas` slash invocation; no duplicate `commands/atlas.md` is needed.
- Codex exposes the same `skills/atlas/SKILL.md` shape as the native `/atlas` invocation; Codex has no separate
  prompts file in this package.
- `zcode/atlas` — a ZCode plugin: `.zcode-plugin/plugin.json`, the same skill with a section for ZCode, and the
  dynamic workflow that section runs ([[zcode-atlas-workflow]]). A ZCode build without the `CreateWorkflow` tool
  (dynamic workflows are not in every release yet) gets the same job turn by turn from the skill's own steps, and
  the agent says which path it took. ZCode also reads Claude Code's format, but its package says something Claude
  Code's does not, so it is its own.
- `gugu/spexcode` — a gugu App: a tab beside a task showing that working copy's spec tree, drift and diagrams, a
  program the tab reads through, and the atlas and spexcode skills for gugu's agents ([[gugu-app]]). gugu's
  sessions are its own, so the App hands work to them rather than starting SpexCode's.
- `penguin/use-spexcode` — a PenguinHarness library plugin: `plugin.json` with that library's dated version,
  bilingual descriptions and category, an `icon.svg`, the `package.json` its loader resolves, and the skill. The
  `use-` prefix is that library's rule for a plugin built around another product.

The hosts that do not expose a native `/atlas` skill command keep their own surface: ZCode uses `plugins.dirs` and
the shipped dynamic workflow, gugu gives the skill to its agents and draws from its tab's Draw button, and PenguinHarness reads the skill from its library
path. The package does not invent a second command format for those hosts.

**The root is the marketplace; the subfolders are packages.** Claude Code and Codex add `distribution/` as the
marketplace root and install the named package with the commands above. ZCode lists `zcode/atlas` in
`plugins.dirs`, gugu installs the folder from its App page, and PenguinHarness copies the skill into an agent's `skills/`.

**Nothing installed, nothing configured.** Every package runs SpexCode through npx, and a repository without a
spec tree is seeded by `spex init --pure` — the skeleton verb that exists for exactly this: `.spec/spexcode.json`
and a root `spec.md`, no git hooks, no agent configuration, nothing outside `.spec/` ([[spex-init]]). The packages
say `--pure` rather than hand-writing that root, because the config it plants is what makes the tree self-describing:
without it `spex spec lint` falls back to built-in `governedRoots` that name SpexCode's own source directories, and
a foreign repository is told it governs nothing. Measured on a fresh home directory, that path leaves npm's own
package cache and, from `spex spec lint`, a history cache of a few kilobytes under `~/.spexcode/projects/`;
`spex init --harness none` would add about thirty seeded `.plugins` files, six git hooks and a project store. The page the skill ends with
needs the dashboard package too, and npx fetches it for that one command. Which REGISTRY that fetch names is part of
the instruction, not an assumption: npx reads npm's config from the working directory, and the working
directory is the repository being drawn — a company monorepo routinely ships an `.npmrc` pinning an internal
registry that has never heard of SpexCode, so the skill's first command dies against a host the reader cannot
reach. Every package names the public registry for its own fetch, which says nothing about how that repository
installs its own dependencies. **Generated is not the same as covered.** The ZCode package also ships a
hand-written workflow script the generator never touches, and it drifted exactly where nobody was looking:
every `SKILL.md` moved to the public registry and off the prerelease pin while that script kept fetching
`spexcode@next` with no registry, in the very argv ZCode executes. A gate that reads only the generated files
cannot see a hand-written one, so the gate reads every shipped file that spells the command.

**A package is installable by the command its host actually offers.** Matching a host's file shape is only half
of it: Claude Code and Codex both resolve a plugin out of a MARKETPLACE, never a bare plugin directory. A plugin
manifest that VALIDATES is not a plugin that installs — `claude plugin validate` passes on exactly the directory
`claude plugin marketplace add` then refuses. So `distribution/` is one marketplace root and each host reads its
own manifest from its own dotted path inside it, which is why one mirrored directory serves both. A package whose
layout is right and whose install path does not exist has not been packaged for that host at all.

**Authored here, installed from a repository that holds nothing else.** Both hosts clone the WHOLE repository a
marketplace names — measured on this one, adding it fetches 33M and 1605 files for a skill that is four — and the
`owner/repo` form reads the manifest only at the repository ROOT, so a subdirectory cannot be addressed. Putting
the marketplace here would hand every adopter the product repository. The packages are therefore generated here,
where the preset they come from lives, and mirrored to a thin repository that is only ever equal to
`distribution/`. Keeping the two equal is CD's job, not a person's, and it runs only when `distribution/` itself
changed: a mirror republished by an unrelated push is a mirror nobody can date. The job regenerates before it
mirrors, so what adopters install is what the generator writes rather than a snapshot of a hand-edit.

**The tree is written in the language the person asked in.** Titles, descriptions, bodies, diagram labels and
the report: an atlas is read by a human, and one handed over in a language they did not use is a translation
job left for them.

**Generated from one source, written by hand where a person decides.** `npm run build:distribution` writes every
manifest and every `SKILL.md` from the atlas preset in `.plugins`, read through the same projection that writes
the init templates, so each package says what adopters are seeded; it adds only the lines a repository without
SpexCode needs first and the line that hands over the page. Versions follow the repository's version, and the TAG follows from it: while
that version is a prerelease every command names npm's `next` tag, the only tag then carrying these verbs;
once it is a release they name no tag at all, because `latest` is the release and `next` is by then the older
of the two — a package still pinning `@next` hands an adopter a build older than the one they would get by
asking for nothing. The gugu App's
manifest, its pinned spex command, its two skills and its copies of archify — the renderer bundled for a browser, the focus module, the stylesheet — are generated from
`packages/archify` with a pinned esbuild, so they stay byte-for-byte what the dashboard draws. The gugu page loads the generated focus helper and prompt as classic scripts, so they expose globals. Archify keeps its
top-level-await ESM bundle as `archify.mjs`; the classic tab page loads it with a local dynamic import. The tab
loads those helpers in order. `npm run lint` fails while any generated file is stale. The ZCode workflow and the
gugu App's page and program are written by hand and the generator never touches them.

**Proof is each host's own code.** `npm run test:distribution` renders every archify example and every committed
diagram through the gugu bundle and requires the same SVG the renderer gives, runs the gugu App's program against a working copy and an npx that records its argv, and checks that every file a package names exists. Beyond CI: the Claude Code package passes
`claude plugin validate --strict` and loads with `--plugin-dir`; ZCode's own plugin discovery loads the ZCode
package from `plugins.dirs` with no diagnostics and its workflow compiler accepts the script; gugu installs the App from its folder and the tab draws this repository's tree; PenguinHarness's skill reader parses the skill.
