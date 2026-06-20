# SpexCode — notes for agents working in this repo

SpexCode is a spec-driven, self-developing dev tool that **dogfoods itself**: every change to the
tool is recorded as a versioned *spec node* and merged into `main` through a `node/*` branch. Read
this before starting — it's the stuff that isn't obvious from the file tree, and it's what costs an
agent the most time to rediscover.

## The dogfood ritual (how every change lands)

A change isn't "done" until it's a spec node merged into `main`. The work splits across two roles: the
**doer** (the agent/worker in a `node/<id>` worktree) builds the change and *proposes* the merge; the
**manager** (the human reviewer) reviews, performs the merge, and cleans up. Keeping the merge in human
hands is deliberate — the doer never merges itself.

Doer (in the `node/<id>` worktree):

1. Branch `node/<id>` off `main`. For a dispatched worker the backend already did this.
2. Make the code change **and** add/update the spec node (`.spec/.../<id>/spec.md`) that states the
   intent. The body is a **living current-state document** — a repeat change *rewrites* it to describe
   the node's present intent, never appends a `## vN` changelog (version history is git's job — see
   "Git is the database" below).
3. Commit on the node branch: `spec: <id> — <reason>`, with a `Session: <sess-id>` trailer in the
   commit **body** — that trailer is the version's attribution (see "Git is the database" below).
4. **Propose** the merge — don't merge yourself: commit first, then `spex done --propose merge`. (A
   manual `git merge` from the worktree trips the safety gate, which expects the branch to still be
   ahead of `main`.) The doer's job ends here, with the proposal awaiting review.

Manager (the human reviewer, after reviewing the proposal):

5. Merge into `main` with `--no-ff`: `merge node/<id>: <reason>`.
6. Delete the node branch; retire the worktree.

`main-guard` (a pre-commit hook) **blocks direct commits on `main`**; merges pass because `MERGE_HEAD`
is set, and node-branch commits pass because they aren't on `main`. Escape hatch for seeding/topology
only: `SPEXCODE_ALLOW_MAIN=1 git commit …`. Install/repair the hook with `npm run hooks` — **re-run it
after the hook source (`scripts/hooks/pre-commit`) changes**, since `.git/hooks/pre-commit` is a copy.

Convention for live work: worktrees in `.worktrees/`, branch `node/<id>`, plus an untracked `.session`
file (`node:` / `session:` / `status:` lines) that the layout linker reads.

## What a spec node is

- A node = a directory under `.spec/` containing a `spec.md`. `id` = directory basename; `parent` =
  the nearest ancestor directory that also has a `spec.md`. The tree root is **`.spec/spexcode`**
  (the project), with package children `spec-dashboard` (UI), `spec-cli` (server + source-of-truth
  guards), and `spec-yatsu` (pending). A node is a *directory*, not a file — that's what lets it both
  nest (children = subdirs) and co-locate assets; the id lives in the dir name, so the file is always
  `spec.md` (never `<id>.md` — that would duplicate the id).
- `spec.md` = frontmatter (`title`, `status` ∈ merged|active|pending, `session`, `hue`, `desc`,
  optional `code:` list) + a markdown body.
- **The body is a living current-state document, never a changelog.** It always describes the node's
  *present* intent; you rewrite it in place, you do not accrete `## vN` sections. (Markdown headings
  `## …` / `###` are fine for *structure* — what's banned is a heading whose text is a version, i.e.
  `## vN …`.) `spex lint`'s **living** rule enforces this. Version evolution is read from git and
  shown in the dashboard's **recent / history** tabs (each commit's reason, session, and line-diff).
- **Git is the database.** A node's `version` is the number of **content commits** to its `spec.md`
  (`git log --follow`, *excluding pure renames* — moving a file in a reparent isn't a version); the
  recent/history rows are those same commits, each attributed via the `Session:` commit trailer.
  There is no separate datastore — the dashboard is a read-time aggregator over git.

## Kinds of commit (not every commit is a spec commit)

Git knows nothing about specs. A commit becomes a node's *version* **only because it changed a file
under `.spec/`** — the entire data extraction is `git log -- .spec/.../<id>/spec.md`. The `spec:`
message prefix is cosmetic: what counts is *which file the commit touched*, not what its subject says.

Three kinds of commit coexist in history:

- **Spec commit** — touches a `.spec/**/spec.md` (in the ritual, bundled with the code change it
  justifies). Becomes a version row: subject = the "reason", `Session:` trailer = attribution.
- **Merge commit** — `merge node/<id>: …`, the `--no-ff` gate onto `main`. Not a version itself.
- **Plain code/docs commit** — touches code or docs but no `spec.md` (e.g. the early `spec-cli:` /
  `spec-dashboard:` build commits, or this `CLAUDE.md`). **Invisible to the spec timeline** — just
  ordinary git.

So you *can* commit code without a spec, and the engine simply ignores it. The ritual deliberately
fuses the code change and the `spec.md` change into one spec commit so intent and implementation move
together — that is a project choice, not a git requirement.

## Architecture / data flow

- `spec-cli/` — Hono backend, run with `tsx` (**no build step**; `npx tsc --noEmit` to type-check).
  Reads `.spec` + git live and serves `GET /api/specs`, `GET /api/specs/:id/history`,
  `GET /api/layout`. Loader: `src/specs.ts`; git access: `src/git.ts`; portability seam:
  `src/layout.ts` (`resolveLayout()`, optional `spexcode.json` override for non-default layouts).
- `spec-dashboard/` — Vite + React. `src/data.js` fetches `/api/specs` and **decorates client-side**
  with only the x/y tidy-tree layout (a pure view concern — the backend has no pixels). Everything
  else, including the A→B `evidence` links, is served by the backend; the dashboard no longer
  fabricates screenshots (absent evidence reads as "none"). `data.js` still carries a mock session
  log as a stand-in for the real tmux/yatsu feed.
- `spec-yatsu` — named as the third package (computer-use A→B evidence) but **not yet present**.

## Running it

- Backend: `npm run api` → http://localhost:8787
- Frontend: `npm run web` → Vite. **Port 5173 by default but not pinned** — it takes the next free
  port (e.g. 5174) and prints `Local: http://localhost:<port>/`; read that line for the real port.
  Vite proxies `/api` → :8787, so the backend must be running too.
- `spex lint` (CLI: `spec-cli/src/cli.ts` → `lint.ts`; or `npm run lint`) checks the spec↔code graph:
  **integrity** (error — a `code:` path doesn't exist), **living** (error — a body contains a `## vN`
  changelog heading instead of staying current-state; see "the body is a living document" above),
  **coverage** (warn — a governed source file isn't claimed by any spec), **drift** (warn — a
  governed file changed after its spec's last version, derived live from git, no stored hashes). The
  pre-commit hook is a thin shim over it that blocks on errors only; bypass with `SPEXCODE_SKIP_LINT=1`. NOTE: anything calling git from inside a hook must
  go through `git.ts`'s `git()` helper, which strips the hook's exported `GIT_DIR`/`GIT_INDEX_FILE`
  (otherwise repo discovery resolves to the cwd and the lint silently sees zero specs).
- A spec node declares the files it owns via a `code:` list in its frontmatter — that edge is what
  `spex lint` and (later) the LLM judge anchor to.
- Toolchain: **npm, not pnpm**; Node is pinned via `.nvmrc` (22).

### Worker auth — dispatched sessions use `SPEXCODE_CLAUDE_CMD`

The backend launches every dispatched worker via `process.env.SPEXCODE_CLAUDE_CMD` (default
`claude --dangerously-skip-permissions`). In a **non-interactive** shell `claude` can resolve to an
expired binary instead of your interactive login, so **workers 401 (`Please run /login · API Error:
401 Invalid bearer token`) even when your own Claude Code is perfectly healthy** — the dispatched
process is on a different credential path than your shell alias. Fix: start the backend with
`SPEXCODE_CLAUDE_CMD` pointing at a **known-good launcher** (here, the `reclaude` wrapper):

```
SPEXCODE_CLAUDE_CMD='/abs/path/to/reclaude --dangerously-skip-permissions' npm run serve
```

run inside the dedicated `spex-backend` tmux. Gotchas worth knowing:
- The var is **not persisted**. Restart the backend (or let a watchdog restart it) *without* it and
  every **new** worker 401s, while already-running workers keep their good launch. Bake it into the
  launch command / watchdog, not an ad-hoc export — losing it is the usual cause of a sudden 401 wave.
- An already-401'd worker does **not** recover via `resume` (that re-attaches to the still-broken
  process). **Close it, kill its tmux session (`tmux -L spexcode kill-session -t <id>`), then
  re-dispatch.**
- This is distinct from a *genuine* token expiry (which needs **you** to re-login). The tell: your
  interactive Claude Code works and only dispatched workers fail → wrong launcher, not a dead token.

## Setup / onboarding

The pre-commit hook is **per-clone, not committed** (`.git/hooks/` is never in the repo), so a fresh
clone must install it once — that's the answer to "when do we set up the hook": **at onboarding, right
after install, before the first commit.**

1. `npm install` in each package you use (`spec-cli`, `spec-dashboard`).
2. `npm run hooks` — copies `scripts/hooks/pre-commit` into the shared git hooks dir (covers every
   worktree). Re-run it whenever the hook source changes.

The hook is **advisory** — bypassable, and absent on any machine that skipped step 2. The real gate is
**CI running `spex lint`**; treat the hook as fast local feedback, CI as enforcement.

Adopting SpexCode on an existing project (no restructure needed — the layout seam handles where things
live):

1. Add `.spec/<area>/spec.md` nodes for the parts you want governed, each with a `code:` list pointing
   at the existing files.
2. `npm run hooks`.
3. Run `spex lint` — the **coverage** warnings are your adoption TODO: every source file not yet
   claimed by a spec. Work the list down; promote coverage to an error once the graph is complete.
4. If your layout differs from the default (main at root, worktrees in `.worktrees/`, `node/<id>`
   branches), drop a `spexcode.json` to point the tool at your structure instead of forking it.

## Naming

The project is **SpexCode**. npm root package: `spexcode`; CLI package: `@spexcode/spec-cli`. The
package *directory* names (`spec-cli`, `spec-dashboard`, `spec-yatsu`) are component names and stay
lowercase-hyphen — they are not the brand. Env escape hatch: `SPEXCODE_ALLOW_MAIN`. Optional layout
override file: `spexcode.json`.
