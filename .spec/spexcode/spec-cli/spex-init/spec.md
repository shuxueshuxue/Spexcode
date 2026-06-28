---
title: spex-init
status: active
hue: 200
desc: `spex init [dir]` scaffolds a repo to adopt SpexCode by copying shipped DATA templates, never code-embedded strings.
code:
  - spec-cli/src/init.ts
---
# spex-init

`spex init [targetDir]` (default: cwd) bootstraps a fresh repo into SpexCode. Adoption is **data, not
code**: every prompt/contract the command plants is a real `spec.md` shipped as a template file and
**copied** — no prompt string is ever embedded in the CLI source. The seed is therefore edited the same
way any spec is: by editing the template files, not the code.

What it plants, both resolved from the CLI package's OWN location via `import.meta.url` (so `init` works
when the package is installed outside the dogfood repo — never a hardcoded repo path):

- **The seed spec tree** — `templates/spec/*` copied into `<dir>/.spec/`: a root `project` node plus a
  default `.config` of dev-flow plugins. The plugins are flat child nodes, each tagged with a `surface`
  field: `core` + `forge-link` (`surface: system`, the contract) plus the `surface: slash` presets
  (`extract`, `memory-hygiene`, `regroup`, `scenario`, `supervisor`, `tidy`), each a verbatim copy of the
  dogfood `.config` node — kept in lockstep per [[init-preset]] so a fresh adopt ships the
  *current* plugin set, not a drifted one. The spexcode-only `taste` and `voice-before-ask` are
  deliberately NOT seeded.
- **The git hooks** — `templates/hooks/*` (the main-guard pre-commit and session-stamp
  prepare-commit-msg) copied into the target's resolved common hooks dir. This is the **one canonical
  hook source**: `scripts/install-hooks.sh` (the monorepo's `npm run hooks`) installs the very same
  files, so the two paths can't drift (see [[main-guard]]). They ship inside the package so a relocated
  install still carries them.
- **A starter `spexcode.json`** — `templates/spexcode.json` copied to `<dir>/spexcode.json`. Without it
  an adopter inherits SpexCode's own [[spec-lint]] defaults, whose `governedRoots` name *this* repo's
  dirs; absent in the adopter's tree, lint would silently govern nothing and read falsely-clean. The
  starter points `governedRoots` at `src/`; the adopter retargets it, and lint stays loud until it does.

**A git work tree is a precondition, checked first.** SpexCode is git-backed — git is the version
database and the hooks live in `.git` — so a non-git target would leave a *half-state*: specs on disk but
no history, no hooks, no sessions. `init` therefore rejects a non-git target **before writing anything**,
with one actionable error pointing at `git init`. It deliberately does **not** run `git init` itself:
creating a repo is a side effect beyond init's remit (a subdir, a dir not meant as a repo root), and the
repair is one command.

**Adoption is additive, never destructive.** No existing file is overwritten: an existing `<dir>/.spec`
aborts the spec phase with a warning, and an existing hook is left untouched. On success it prints the
next steps — install the packages, edit `project/spec.md`, run the backend, confirm `spex lint` is clean.
