# SpexCode — notes for agents working in this repo

SpexCode is a spec-driven, self-developing dev tool that **dogfoods itself**: every change to the
tool is recorded as a versioned *spec node* and merged into `main` through a `node/*` branch. Read
this before starting — it's the stuff that isn't obvious from the file tree, and it's what costs an
agent the most time to rediscover.

## The dogfood ritual (how every change lands)

A change isn't "done" until it's a spec node merged into `main`:

1. Branch `node/<id>` off `main`.
2. Make the code change **and** add/update the spec node (`.spec/.../<id>/spec.md`) that states the
   intent. A repeat change to an existing node appends a `## vN — <summary>` section to its `spec.md`.
3. Commit on the node branch: `spec: <id> — <reason>`, with a `Session: <sess-id>` trailer in the
   commit **body** — that trailer is the version's attribution (see "Git is the database" below).
4. Merge into `main` with `--no-ff`: `merge node/<id>: <reason>`.
5. Delete the node branch; retire the worktree.

`main-guard` (a pre-commit hook) **blocks direct commits on `main`**; merges pass because `MERGE_HEAD`
is set, and node-branch commits pass because they aren't on `main`. Escape hatch for seeding/topology
only: `SPEXCODE_ALLOW_MAIN=1 git commit …`. Install/repair the hook with `npm run hooks` — **re-run it
after the hook source (`scripts/hooks/pre-commit`) changes**, since `.git/hooks/pre-commit` is a copy.

Convention for live work: worktrees in `.worktrees/`, branch `node/<id>`, plus an untracked `.session`
file (`node:` / `session:` / `status:` lines) that the layout linker reads.

## What a spec node is

- A node = a directory under `.spec/` containing a `spec.md`. `id` = directory basename; `parent` =
  the nearest ancestor directory that also has a `spec.md`. The tree root is `.spec/spec-dashboard`.
- `spec.md` = frontmatter (`title`, `status` ∈ merged|active|pending, `session`, `hue`, `desc`) + a
  markdown body. Subsequent versions are appended as `## vN — …` sections in the same file.
- **Git is the database.** A node's `version` is the number of commits that touched its `spec.md`
  (`git log --follow -- <path>`); history rows come from the same log, each attributed via the
  `Session:` commit trailer. There is no separate datastore — the dashboard is a read-time aggregator.

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
- `spec-dashboard/` — Vite + React. `src/data.js` fetches `/api/specs` and **decorates client-side**:
  it computes each node's x/y (a left→right tidy tree) and generates placeholder SVG A/B screenshots
  and mock session logs. Treat `data.js` as a stand-in for the real git/tmux/yatsu feed.
- `spec-yatsu` — named as the third package (computer-use A→B evidence) but **not yet present**.

## Running it

- Backend: `npm run api` → http://localhost:8787
- Frontend: `npm run web` → Vite. **Port 5173 by default but not pinned** — it takes the next free
  port (e.g. 5174) and prints `Local: http://localhost:<port>/`; read that line for the real port.
  Vite proxies `/api` → :8787, so the backend must be running too.
- `spex lint` (CLI: `spec-cli/src/cli.ts` → `lint.ts`; or `npm run lint`) checks the spec↔code graph:
  **integrity** (error — a `code:` path doesn't exist), **coverage** (warn — a governed source file
  isn't claimed by any spec), **drift** (warn — a governed file changed after its spec's last version,
  derived live from git, no stored hashes). The pre-commit hook is a thin shim over it that blocks on
  errors only; bypass with `SPEXCODE_SKIP_LINT=1`. NOTE: anything calling git from inside a hook must
  go through `git.ts`'s `git()` helper, which strips the hook's exported `GIT_DIR`/`GIT_INDEX_FILE`
  (otherwise repo discovery resolves to the cwd and the lint silently sees zero specs).
- A spec node declares the files it owns via a `code:` list in its frontmatter — that edge is what
  `spex lint` and (later) the LLM judge anchor to.
- Toolchain: **npm, not pnpm**; Node is pinned via `.nvmrc` (22).

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
