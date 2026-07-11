---
title: spex-init
status: active
hue: 200
desc: `spex init [dir]` scaffolds a repo to adopt SpexCode by copying shipped DATA templates, never code-embedded strings; its messages report what was actually planted. Footprint needs no vote — one residence behavior, decided by kind.
code:
  - spec-cli/src/init.ts
related:
  - spec-cli/src/init.test.ts
---
# spex-init

`spex init [targetDir]` (default: cwd) bootstraps a fresh repo into SpexCode. Adoption is **data, not
code**: every prompt/contract the command plants is a real `spec.md` shipped as a template file and
**copied** — no prompt string is ever embedded in the CLI source. The seed is therefore edited the same
way any spec is: by editing the template files, not the code.

What it plants, both resolved from the CLI package's OWN location via `import.meta.url` (so `init` works
when the package is installed outside the dogfood repo — never a hardcoded repo path):

- **The seed spec tree** — `templates/spec/*` copied into `<dir>/.spec/`: a root `project` node plus a
  default `.config` of dev-flow plugins, each a flat child carrying a `surface` field (the `system`
  contract `core` + `forge-link`, and the `command` presets), a verbatim copy of the dogfood `.config`
  node so a fresh adopt ships the *current* set. That default `.config` is the **default preset**; with
  `--preset <name>` the named non-default package under `templates/presets/<name>/` is copied in **on top**
  — cumulative, so `careful` stacks its plugins over the default set. The spexcode-only plugins live only
  in the dogfood `.config`, never in the template, so they are never seeded. [[init-preset]] owns which
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
  fresh repo just works and a mature one can still curate explicit roots. It also seeds the default
  [[launcher-select]] launchers — `claude` and `codex` as ordinary `sessions.launchers` entries plus
  `sessions.defaultLauncher: "claude"` — so session-create works out of the box without any env var; a host
  that needs an auth-wrapper command edits that launcher's `cmd` in `spexcode.local.json`.

**What init prints is TRUE of what it planted.** The success message and the next-steps read the
`governedRoots` value back from the just-planted (or pre-existing) file and interpolate it — never a string
literal restated in the code, which is how the message once claimed a `["src"]` starter while the template
seeded `["."]` (the first-minute lie a real field adoption hit).

**Adoption asks no footprint question.** The retired `--render` vote is gone: materialized artifacts are
never tracked
([[residence]]), so init's own materialize covers a host-TRACKED contract file with the clean/smudge
filter on the spot — clean status, no "mystery M", no decision hint — and hides wholly-ours artifacts in
the per-clone exclude without touching the host's `.gitignore`. A lingering `render`/`private` field in a
pre-existing config is ignored with a loud non-fatal notice; nothing about it is ever fatal to adoption.

**An illegal harness-target set fails loud, up front.** Before materializing, `init` validates the project's
[[harness-select]] `harnesses` set (from the just-planted/existing `spexcode.json`) and aborts with a stated
reason on an illegal one — a plugin paired with a native harness, or a plugin with no landing folder — rather
than letting the later materialize swallow it as a soft "skipped" warning. A fresh starter `spexcode.json`
omits the field (defaulting to every native harness), so this only bites a hand-edited or re-init'd config —
exactly where a clear error belongs.

**A git work tree is a precondition, checked first.** SpexCode is git-backed — git is the version
database and the hooks live in `.git` — so a non-git target would leave a *half-state*: specs on disk but
no history, no hooks, no sessions. `init` therefore rejects a non-git target **before writing anything**,
with one actionable error pointing at `git init`. It deliberately does **not** run `git init` itself:
creating a repo is a side effect beyond init's remit (a subdir, a dir not meant as a repo root), and the
repair is one command.

**Adoption is additive, never destructive.** No existing file is overwritten: an existing `<dir>/.spec`
aborts the spec phase with a warning, and an existing hook is left untouched. On success it prints the
next steps — install the packages, edit `project/spec.md`, run the backend, confirm `spex lint` is clean.
