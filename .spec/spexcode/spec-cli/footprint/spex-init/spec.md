---
title: spex-init
status: active
hue: 200
desc: `spex init [dir]` scaffolds a repo to adopt SpexCode by copying shipped DATA templates, never code-embedded strings; its messages report what was actually planted. Footprint needs no vote — one residence behavior, decided by kind.
code:
  - spec-cli/src/init.ts#specInit
related:
  - spec-cli/src/init.test.ts
  - packages/spec-core/templates/spexcode.json
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
  sets exist; this command owns the copy. Hook nodes are selected from the same chosen native adapter set as
  launchers: a hook is seeded when at least one selected adapter declares one of its events. A hook whose
  declared events are unreachable from every selected native adapter is omitted together with its co-located
  script; it could never be delivered. This is event-data intersection, not a harness-name branch, so a
  multi-harness selection keeps a hook when either adapter can emit it. Plugin-only delivery retains the
  complete seed because its host adapter is outside this native selection.
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
  SELECTED harness (from the template's per-harness pool, `sessions.defaultLauncher` = the first). Interactive
  harnesses seed their plain command, preserving the tool's normal permission model; auth wrappers and
  automatic-permission flags remain explicit user or host-local launcher definitions for those adapters. The
  independent `opencode-headless` adapter is the deliberate exception: its runnable non-interactive form is
  `opencode --auto`, so that exact command is its seed rather than a plain command that would reopen the TUI.
  Thus session-create works out of the box without seeding launchers for tools the adopter never picked. The same
  starter explicitly plants `dashboard.showHeadlessLaunchers: false`, [[launcher-visibility]]'s portable default.
  The template is also the one numeric-default source for the `uploads` transfer policy; its portable values
  can be committed as-is or locally overridden through the normal `spexcode.local.json` overlay, never through
  an upload-specific config file.
  Adoption also records the root checkout's current branch as `mainBranch`: this is the one moment detection is
  authoritative. Later ordinary `git switch` operations cannot redefine a feature branch as trunk. A re-init
  preserves an explicit value and fills a missing one without changing the surrounding config.

**What init prints is TRUE of what it planted.** The success message and the next-steps read the
`governedRoots` value back from the just-planted (or pre-existing) file and interpolate it — never a string
literal restated in the code, which is how the message once claimed a `["src"]` starter while the template
seeded `["."]` (the first-minute lie a real field adoption hit). Harness-artifact reporting follows the same
rule: materialize returns a receipt of the contract, shim, skill/agent, plugin, and trust artifacts its selected
adapters actually asserted, and init renders that receipt. A Claude-only init therefore cannot claim AGENTS,
Codex shims, or Codex trust; a Codex-only init cannot claim CLAUDE or Claude shims.

The seeded `.spec/` tree and `spexcode.json` are project source of truth, so init names them as files to add
and commit. Generated harness files such as `.codex/`, `.claude/`, and `AGENTS.md` are machine-local and
remain untracked. Until the project data is tracked, the existing `spex spec lint` gate reports an integrity
error rather than treating the untracked seed as a clean graph; it gives the ordinary Git repair command and
does no separate adoption workflow.

**Adoption asks no footprint question.** The retired `--render` vote is gone: materialized artifacts are
never tracked
([[residence]]), so init's own materialize covers a host-TRACKED contract file with the clean/smudge
filter on the spot — clean status, no "mystery M", no decision hint — and hides wholly-ours artifacts in
the per-clone exclude without touching the host's `.gitignore`. A lingering `render`/`private` field in a
pre-existing config is ignored with a loud non-fatal notice; nothing about it is ever fatal to adoption.

**The harness delivery choice is REQUIRED, up front.** `--harness <id[,id]|plugin:<folder>|none>` names which
harnesses [[harness-select]] delivers into; init stamps it into `spexcode.json` as the persistent `harnesses`
field (an explicit `--harness` on a re-init restamps that field of an existing config; the same write also
fills a missing stable `mainBranch`, preserving every other field). A pre-existing explicit field satisfies
the requirement without the flag. Neither → init aborts
BEFORE writing anything, like the git precondition — there is deliberately no default set, because with many
registered harnesses "deliver to all" would litter the adopter's tree and global tool configs with artifacts
for CLIs they never installed. An ILLEGAL set (unknown id, plugin paired with a native, plugin with no
landing folder) fails just as loud, up front — never a soft "materialize skipped" warning.

REQUIRED means *stated*, not *non-empty*. `--harness none` stamps the empty set: adoption seeds the spec
tree, plants `spexcode.json`, installs the git hooks, and writes NOTHING into any agent's config. That is the
L0-only posture — the spec asset and its lint, adopted by a repo whose agent SpexCode does not adapt, or by
one that wants the data and none of the wiring — and refusing it would make "choose a vendor's harness" the
price of admission to a layer that has no vendor in it. It is not the same as a MISSING field: `[]` is a
choice, `undefined` is the absence of one, and only the second aborts. Because nothing is delivered, nothing
needs hiding either — the tree's `.gitignore` block is not written at all, rather than written to ignore only
itself. Selecting a harness later is the ordinary [[harness-select]] selection change, self-healing at the
next git-native anchor; no re-adoption.

**A git work tree is a precondition, checked first.** SpexCode is git-backed — git is the version
database and the hooks live in `.git` — so a non-git target would leave a *half-state*: specs on disk but
no history, no hooks, no sessions. `init` therefore rejects a non-git target **before writing anything**,
with one actionable error pointing at `git init`. It deliberately does **not** run `git init` itself:
creating a repo is a side effect beyond init's remit (a subdir, a dir not meant as a repo root), and the
repair is one command. When `mainBranch` is not already explicit, the root checkout must name a branch;
detached adoption fails loud with the repair instead of silently stamping a guessed trunk.
All of those adoption Git queries use [[git-exec]]'s resolved executable for their inherited PATH, so the
same selected Git binary serves the precondition, common-hooks lookup and branch read without each child
repeating PATH resolution.

**Adoption is additive and preserves user ownership.** An existing `<dir>/.spec` aborts the spec phase with
a warning. A user-owned hook is never executed as a probe and never overwritten. SpexCode-owned hook
snapshots carry a managed header that proves ownership, so re-init atomically refreshes that snapshot to the
current protocol. This is necessary
when a protocol moves work between hooks: leaving an old SpexCode pre-commit beside new arm/consume hooks
would keep judging `HEAD` first and block the repair before the candidate gate can see it. A modified or
unknown hook remains the user's and is left byte-for-byte untouched; the canonical pre-commit detects that
collision statically and retains the old HEAD lint rather than silently removing local coverage. On success
init prints what it installed, refreshed, and preserved, then the next steps — install the packages, edit
`project/spec.md`, run the backend, confirm `spex lint` is clean.
