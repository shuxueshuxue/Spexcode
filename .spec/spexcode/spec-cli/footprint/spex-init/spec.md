---
title: spex-init
status: active
hue: 200
desc: `spex init [dir]` scaffolds a repo to adopt SpexCode by copying shipped DATA templates, never code-embedded strings; its messages report what was actually planted. Footprint needs no vote — one residence behavior, decided by kind.
code:
  - spec-cli/src/init.ts#specInit
related:
  - spec-cli/src/init.test.ts
  - spec-cli/templates/spexcode.json
---
# spex-init

`spex init [targetDir]` (default: cwd) bootstraps a fresh repo into SpexCode. Adoption is **data, not
code**: every prompt/contract the command plants is a real `spec.md` shipped as a template file and
**copied** — no prompt string is ever embedded in the CLI source. The seed is therefore edited the same
way any spec is: by editing the template files, not the code.

What it plants, both resolved from the CLI package's OWN location via `import.meta.url` (so `init` works
when the package is installed outside the dogfood repo — never a hardcoded repo path):

- **The seed spec tree** — `templates/spec/*` copied into `<dir>/.spec/`: a root `project` node plus a
  default `.plugins` of dev-flow plugins, each carrying a `surface` field (the `system` contract `core`
  flat + the auxiliary contracts under the `prompts/` shelf, the `command` presets under `commands/`, the
  `skill` plugins under `skills/`, and `core`'s lifecycle `hook` children), a projection of the dogfood `.plugins`
  node so a fresh adopt ships the *current* set. That default `.plugins` is the **default preset**; with
  `--preset <name>` a named non-default package under `templates/presets/<name>/` would be copied in **on
  top** — cumulative — though no non-default tier ships today. The spexcode-only plugins live only
  in the dogfood `.plugins`, never in the template, so they are never seeded. [[init-preset]] owns which
  sets exist; this command owns the copy.
- **The git hooks** — `templates/hooks/*` (the main-guard + footprint-surgery pre-commit, the
  footprint-refresh post-checkout/post-merge anchors ([[commit-surgery]]), and the session-stamp
  prepare-commit-msg) copied into the target's resolved common hooks dir. This is the **one canonical
  hook source**: `scripts/install-hooks.sh` (the monorepo's `npm run hooks`) installs the very same
  files, so the two paths can't drift (see [[main-guard]]). They ship inside the package so a relocated
  install still carries them.
- **A starter `spexcode.json`** — `templates/spexcode.json` copied to `<dir>/spexcode.json`. Without it
  an adopter inherits SpexCode's own [[spec-lint]] defaults, whose `governedRoots` name *this* repo's
  dirs; absent in the adopter's tree, lint would silently govern nothing and read falsely-clean. The
  starter ships `governedRoots: ["."]` — the zero-config safe default: `.` governs the *whole* project,
  but only git-**tracked** source (so node_modules/build/nested worktrees never count) minus tests, so a
  fresh repo just works and a mature one can still curate explicit roots. The planted file also carries the
  CHOSEN `harnesses` set (next paragraph) and seeds an ordinary [[launcher-select]] launcher for each
  SELECTED harness (from the template's per-harness pool, `sessions.defaultLauncher` = the first). Every
  seeded `cmd` is the harness's plain command, preserving its normal permission model; auth wrappers and
  automatic-permission flags are explicit user or host-local launcher definitions, never init defaults. Thus
  session-create works out of the box without seeding launchers for tools the adopter never picked. The same
  starter explicitly plants `dashboard.showHeadlessLaunchers: false`, [[launcher-visibility]]'s portable default.

**What init prints is TRUE of what it planted.** The success message and the next-steps read the
`governedRoots` value back from the just-planted (or pre-existing) file and interpolate it — never a string
literal restated in the code, which is how the message once claimed a `["src"]` starter while the template
seeded `["."]` (the first-minute lie a real field adoption hit). Harness-artifact reporting follows the same
rule: materialize returns a receipt of the contract, shim, skill/agent, plugin, and trust artifacts its selected
adapters actually asserted, and init renders that receipt. A Claude-only init therefore cannot claim AGENTS,
Codex shims, or Codex trust; a Codex-only init cannot claim CLAUDE or Claude shims.

**Adoption asks no footprint question.** The retired `--render` vote is gone: materialized artifacts are
never tracked
([[residence]]), so init's own materialize covers a host-TRACKED contract file with the clean/smudge
filter on the spot — clean status, no "mystery M", no decision hint — and hides wholly-ours artifacts in
the per-clone exclude without touching the host's `.gitignore`. A lingering `render`/`private` field in a
pre-existing config is ignored with a loud non-fatal notice; nothing about it is ever fatal to adoption.

**The harness delivery choice is REQUIRED, up front.** `--harness <id[,id]|plugin:<folder>>` names which
harnesses [[harness-select]] delivers into; init stamps it into `spexcode.json` as the persistent `harnesses`
field (an explicit `--harness` on a re-init restamps that one field of an existing config, touching nothing
else). A pre-existing explicit field satisfies the requirement without the flag. Neither → init aborts
BEFORE writing anything, like the git precondition — there is deliberately no default set, because with many
registered harnesses "deliver to all" would litter the adopter's tree and global tool configs with artifacts
for CLIs they never installed. An ILLEGAL set (unknown id, plugin paired with a native, plugin with no
landing folder, empty list) fails just as loud, up front — never a soft "materialize skipped" warning.

**A git work tree is a precondition, checked first.** SpexCode is git-backed — git is the version
database and the hooks live in `.git` — so a non-git target would leave a *half-state*: specs on disk but
no history, no hooks, no sessions. `init` therefore rejects a non-git target **before writing anything**,
with one actionable error pointing at `git init`. It deliberately does **not** run `git init` itself:
creating a repo is a side effect beyond init's remit (a subdir, a dir not meant as a repo root), and the
repair is one command.

**Adoption is additive, never destructive.** No existing file is overwritten: an existing `<dir>/.spec`
aborts the spec phase with a warning, and an existing hook is left untouched. On success it prints the
next steps — install the packages, edit `project/spec.md`, run the backend, confirm `spex lint` is clean.
