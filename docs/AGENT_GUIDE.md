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
4. **Propose** the merge — don't merge yourself: commit first, then `spex session done --propose
   merge`. (A manual `git merge` from the worktree trips the safety gate, which expects the branch to
   still be ahead of `main`.) The doer's job ends here, with the proposal awaiting review.

Manager (the human reviewer, after reviewing the proposal):

5. Merge into `main` with `--no-ff`: `merge node/<id>: <reason>`. The merge is itself a **dispatch** —
   the manager reopens the session and the session's *own* agent runs the `git merge` (it knows the
   work's intent and can resolve conflicts); the server never touches `main`'s tree.
6. Delete the node branch; retire the worktree.

**Why you don't restate the ritual when dispatching.** A dispatched worker gets a **task-focused**
launch prompt. The ritual still reaches the worker through product *mechanism*, not prose: the
backend creates the `node/<id>` branch, the `prepare-commit-msg` hook stamps the `Session:` trailer,
the commit-before-declare contract is the **`.config/core`** node — materialized (with this guide)
into the worktree's `CLAUDE.md`/`AGENTS.md` contract block that the harness **auto-discovers**, the
SAME path for a dispatched and a self-launched agent, not a launch-time `--append-system-prompt`
(there is no baked `CORE_CONTRACT` constant — the contract is *data*, a config node) — and the
`--no-ff` merge style is stated at merge time by the merge prompt. So don't restate the flow when
dispatching — the system enforces it.

`main-guard` (a pre-commit hook) **blocks direct commits on `main`**; merges pass because `MERGE_HEAD`
is set, and node-branch commits pass because they aren't on `main`. Escape hatch for seeding/topology
only: `SPEXCODE_ALLOW_MAIN=1 git commit …`. Install/repair the hook with `npm run hooks` — **re-run it
after the hook source (`spec-cli/templates/hooks/pre-commit`) changes**, since `.git/hooks/pre-commit`
is a copy. That `templates/hooks/` dir is the single canonical source `spex init` plants too.

Convention for live work: worktrees in `.worktrees/`, branch `node/<id>`. Session state lives in the
global per-project store (`session.json` under `~/.spexcode/projects/<enc>/sessions/<id>/`), never as
a file inside the worktree.

## Supervising — the manager loop

If you're the **managing session** (you read this file), you're a **manager**, not a worker. Don't
write feature code and don't deep-read source — that's what workers are for. Read the goal node and
this loop, then **dispatch immediately**: decompose the goal into worker-sized tasks and delegate
each. There is no discovery phase.

- **DISPATCH** — `spex session new "<task>"` launches one worker. A session is bound to no node by default;
  the worker finds and reads its governing spec itself. The prompt's first `[[<id>]]` (or
  `--node <id>`, same effect) binds the session to that node: the branch is named
  `node/<id>-<shortid>`, the board attributes the session to it, and if the node exists one line
  with its `spec.md` path is appended to the launch prompt. The first `[[…]]` binds even when the
  id is a passing mention or doesn't exist; a nonexistent id still becomes the branch name. Which
  nodes a session is actually linked to is read from its edit overlay and its commits' `Session:`
  trailers. Give the worker **only its task**; the dev-flow contract reaches it through its own
  system prompt — don't restate it.
- **PARALLELIZE** — dispatch independent tasks **concurrently**. That parallelism is the core payoff
  of spec-driven dev, so reach for it; don't serialize out of caution. Contention on `main` is fine —
  git serializes the merges, and a conflict just means you re-merge. Never throttle parallel work to
  avoid conflicts.
- **MONITOR** — `spex session watch` streams the session lifecycle: `launched` → actionable transitions
  (`review` / `done` / `offline` / `error` / `needs-input`) → `closed`. A booting worker reads
  `starting` (not `offline`) until its control socket is up, and `closed` fires only when a session is
  genuinely gone — so each event is trustworthy and needs no cross-checking against git.
- **WAIT WITH `spex session wait <id>`** — to wait on a dispatched worker, background `spex session wait <id>`: it blocks
  until the worker hits an actionable status, prints it, and **exits** (the exit is your wake-up — the
  harness re-invokes you when the backgrounded command finishes). It **draws the watcher→worker edge on the
  session graph** for the whole wait (so your supervision is visible, not an invisible spin) and is
  **guaranteed to terminate** (a `--timeout`, default 1200s, is the hard wall — a worker stuck in any
  non-actionable state can't hang you). Background one wait per worker; N waits draw N edges. One trap:
  **never block on `spex session watch`** — that's the human's *forever* stream, no `<id>`, and it freezes your turn.
  (`spex session review <id>` / `spex session ls` still return a one-shot snapshot; `spex graph --json` dumps the board JSON for a glance.)
- **REVIEW** — `spex session review <id>` prints the one review payload: commits ahead of `main`, the
  merge-base diff (the worker's real changes), and the merge/typecheck/lint gates. Decide from that —
  you don't hand-run git or read the source.
- **MERGE** — `git -C <root> merge --no-ff <branch>`. Then **confirm the merge landed**: `git -C <root>
  log -1` must show `HEAD` advanced to the new merge commit **before** you go any further. Never close
  an unmerged branch — closing discards the work.
- **CLOSE** — only **after** the merge is confirmed: `spex session close <id>`.
- **GUIDE** — `spex session send <id> "<msg>"` corrects or steers a live worker. Keep `spex spec lint` at
  **0 errors** across the tree.
- **HELP** — lost? `spex help` is the command map, `spex help <cmd>` one command's usage, and
  `spex guide <topic>` the workflows/formats those commands assume. A `--help` probe is always safe:
  it prints and exits before the verb runs.

## What a spec node is

- A node = a directory under `.spec/` containing a `spec.md`. `id` = directory basename; `parent` =
  the nearest ancestor directory that also has a `spec.md`. The tree root is **`.spec/spexcode`**
  (the project). Its children are the package nodes — `spec-cli` (Hono backend + source-of-truth
  guards), `spec-dashboard` (UI), and `spec-forge` (a built, read-only forge **link tracer**) — plus
  the **reflexive config system** (`.config` and `config`, next bullet). A node is a
  *directory*, not a file — that's what lets it both nest (children = subdirs) and co-locate assets;
  the id lives in the dir name, so the file is always `spec.md` (never `<id>.md` — that would
  duplicate the id).
- **The config system is reflexive** — SpexCode's own dev-flow behavior is itself spec nodes, managed
  by the same dogfood ritual. Two roots sit under `spexcode`: **`.config`** holds the concrete
  *instance* plugins (`core` + `forge-link` + `memory-hygiene` + `voice-before-ask` are `surface:
  system`; `extract` + `regroup` + `supervisor` + `tidy` are `surface: command`); **`config`** holds the *spec of
  the config system* itself (`surface`). Each plugin is a **flat** child carrying a `surface`
  frontmatter **field** — `surface: system` materializes its body (in name order) into the
  `<!-- spexcode -->` managed block of the worktree's `CLAUDE.md`/`AGENTS.md`, where the harness
  **auto-discovers** it as always-on context (not a launch-time `--append-system-prompt`); `surface:
  command` exposes it as a `/`-dropdown preset for new sessions.
  There are no `system/`/`command/` bucket dirs and no path-driven surface — the surface *is* the field,
  so every plugin is a real graph child. `spec-cli`'s `loadSystemConfig`/`loadConfig` gather the two
  surfaces; only built/active plugins gather (a `pending` plugin renders on the board but reaches no
  surface).
- `spec.md` = frontmatter (`title`, `status` ∈ merged|active|pending, `session`, `hue`, `desc`,
  optional `code:` list; config nodes also carry a `surface` field) + a markdown body.
- **The body is a living current-state document, never a changelog.** It always describes the node's
  *present* intent; you rewrite it in place, you do not accrete `## vN` sections. (Markdown headings
  `## …` / `###` are fine for *structure* — what's banned is a heading whose text is a version, i.e.
  `## vN …`.) `spex spec lint`'s **living** rule enforces this. Version evolution is read from git and
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
  Reads `.spec` + git live. The dashboard's single source is **`GET /api/graph`** (assembled
  tree + overlay + sessions); other surfaces include `GET /api/specs`, `GET /api/specs/:id/history`
  (+ `/diff/:hash`), `GET /api/layout`, `GET /api/config` (the gathered config surfaces),
  `GET /api/slash-commands`, and the whole **`/api/sessions` state-machine** (list/create/review/
  merge/resume/capture/prompt/close + the **`:id/socket` terminal WebSocket** and `edges`).
  Loader: `src/specs.ts`; git access: `src/git.ts`; sessions/launch: `src/sessions.ts`;
  portability seam: `src/layout.ts` (`resolveLayout()`, optional `spexcode.json` override for
  non-default layouts).
- `spec-dashboard/` — Vite + React. `src/data.js`'s `loadGraph()` fetches **`/api/graph`**; the x/y
  tidy-tree `layout()` is exported from `data.js` but **applied in `App.jsx`** (focus-driven
  drill-down — a pure view concern, the backend has no pixels). The live Sessions console is a **real
  terminal** (`SessionTerm.jsx`) over the `/api/sessions/:id/socket` WebSocket. `data.js` still carries
  a legacy mock `SESSION_LOG`, but it now feeds **only the dormant `TermPane.jsx`**, not the live UI.
- `spec-forge` — a third package node, now **built and `active`**: a host-agnostic, **read-only forge
  link tracer** that reads a forge's open issues/PRs and resolves each to the spec node it serves
  (git/`.spec` stays the single source of truth — a node's status stays git-derived). Real `spec-forge/`
  package (`src/{cli,links,port,cache,resident,proof}.ts`, `src/drivers/github.ts`) with active child
  nodes `forge-cli`, `dashboard-issues`, `freshness`, `links`, `port`.

## Running it

> **Live dogfood deployment** (the public `:443` dashboard, the multi-process topology, the watchdog, and
> the **rebuild-the-dist-on-merge** discipline) is operator infra, deliberately **not** in this product repo
> — it lives in the sibling **`spexcode-ops`** repo (`deploy/` scripts + recipe; secrets via a git-ignored
> `.env`). Reach for it when serving SpexCode publicly or when a merged dashboard change isn't showing up on
> a deployed instance. The notes below are the plain local dev loop.

- Backend: `npm run api` → http://localhost:8787 (a supervisor that hot-reloads `spec-cli/src` and
  owns the public port for zero-downtime restarts).
  - **The supervisor hot-reloads the CHILD server, never ITSELF.** On a `spec-cli/src` change it boots a
    fresh child (`index.ts` + the modules it imports — server logic, `sessions.ts`, …) behind the stable
    public port, so those edits go live on their own. But a change to **`supervise.ts`**, or to **how the
    child is spawned** (its env — e.g. what a launched session inherits), only takes effect on a **FULL
    backend restart** (kill the whole `serve` process / its tmux session, relaunch `npm run api`) — the
    in-place child reload is NOT enough. Tell-tale: the change is merged and on disk, but live behaviour is
    unchanged and the running child still shows the old env (`tr '\0' '\n' < /proc/<child-pid>/environ`).
    (Machine-specific relaunch steps — which tmux socket, the watchdog — live in local notes, not here.)
  - **A second / throwaway instance (e.g. on a shared box already running the deploy):** the backend binds
    `$PORT` (default 8787), so `PORT=<free> npm run api` runs one beside the live one — check the port is
    free first (`ss -tlnH "sport = :<free>"`). **Env footgun:** a dispatched shell already **inherits `PORT`
    and `SPEXCODE_API_URL`** from the backend that launched it, so a bare `npm run api` silently binds that
    *stale inherited* `PORT` and points its child at the **live** `SPEXCODE_API_URL` — pin your own `PORT`
    and `env -u SPEXCODE_API_URL` for a self-contained instance. Liveness probe: `GET /health` → `ok`.
  - **Stopping it — target the instance, never the signature.** Every backend, live or throwaway, has the
    **identical** process signature (`tsx src/cli.ts serve`, child `index.ts`), so `pkill -f '…serve'` kills
    the WRONG one — this has taken the live `:8787` down. Stop by **port** (`ss -tlnp "sport = :<port>"` →
    kill that pid; the supervisor is on your `PORT`, and killing it reaps its child backend on the random
    port too) or, on the deploy, by **tmux session name** (`spex-backend`); a downed deploy service is
    relaunched by the watchdog (`spexcode-ops`'s `spex-ensure.sh`, port-guarded + idempotent).
- Frontend: `npm run web` → Vite. **Port 5173 by default but not pinned** — it takes the next free
  port (e.g. 5174) and prints `Local: http://localhost:<port>/`; read that line for the real port.
  Vite proxies `/api` → :8787, so the backend must be running too.
- `spex session watch` — the **canonical session monitor**: streams actionable session transitions as they
  happen (`spex session ls` for a one-shot table). The dashboard's live Sessions console is the GUI
  equivalent.
- `spex spec lint` (CLI: `spec-cli/src/cli.ts` → `lint.ts`; or `npm run lint`) checks the spec↔code graph:
  **integrity** (error — a `code:` path doesn't exist), **living** (error — a body contains a `## vN`
  changelog heading instead of staying current-state; see "the body is a living document" above),
  **altitude** (warn — a body slid below contract altitude into a mechanics dump: over its line/char
  budget, code-identifier density > 1.3/line, or ≥3 step-by-step lines; budgets overridable via
  `spexcode.json`), **coverage** (warn — a governed source file isn't claimed by any spec), **drift**
  (warn — a governed file changed after its spec's last version, derived live from git, no stored hashes). The
  pre-commit hook is a thin shim over it that blocks on errors only; bypass with `SPEXCODE_SKIP_LINT=1`. NOTE: anything calling git from inside a hook must
  go through `git.ts`'s `git()` helper, which strips the hook's exported `GIT_DIR`/`GIT_INDEX_FILE`
  (otherwise repo discovery resolves to the cwd and the lint silently sees zero specs).
- A spec node declares the files it owns via a `code:` list in its frontmatter — that edge is what
  `spex spec lint` and (later) the LLM judge anchor to.
- To configure SpexCode's runtime settings (launchers, dashboard icon, lint budgets, layout), run
  **`spex guide config`** — the authoritative manual for every `spexcode.json` / `spexcode.local.json`
  field and which of the two files it belongs in (committed & portable vs. gitignored & host-specific).
  Don't reverse-engineer the schema; mirror how `spex guide spec` / `spex guide yatsu` carry the authoring
  formats. Then edit the JSON directly — there is no `spex config set`.
- Toolchain: **npm, not pnpm**; Node is pinned via `.nvmrc` (22).

### Measuring a frontend node's yatsu — drive a real browser

A frontend scenario (a favicon, a rendered view, a tab title) is measured through the **actual running
product**, never by reasoning about the code — and you never file a `spex eval add --pass` off anything
weaker than the browser's real reading. The loop: run the worktree dashboard (`npm run dev` in
`spec-dashboard`; a worktree has no `node_modules`, so symlink the main checkout's first), start a `spex
serve` when the scenario needs a backend/config case (poll `/api/graph` until it reflects your config — the
serve supervisor spawns a child that takes a few seconds to warm), then drive a headless browser to read the
real DOM (`document.querySelector("link[rel~='icon']").href`, `document.title`) and screenshot it, and file
with `spex eval add <node> --scenario <name> --pass --image <png>`. A headless Chromium is available on the
box; where its binary and the driver package live is a machine fact kept in local notes, not here.

### Worker auth — dispatched sessions launch via named launchers (config, not env)

The backend launches every dispatched worker with the session's **launcher** — a named `{ harness, cmd }`
profile from `sessions.launchers` in `spexcode.json` / `spexcode.local.json`, picked at create time
(`--launcher <name>` / the dashboard dropdown, else `sessions.defaultLauncher`). `spex guide config`'s
LAUNCHERS section is the authoritative manual. Config is read live at create time, so a JSON edit
takes effect on the very next dispatch — **no backend restart needed**.

In a **non-interactive** shell the seeded default `claude` cmd can resolve to an expired binary instead of
your interactive login, so **workers 401 (`Please run /login · API Error: 401 Invalid bearer token`) even
when your own Claude Code is perfectly healthy** — the dispatched process is on a different credential
path than your shell alias. Fix: point a launcher at a **known-good wrapper** (e.g. `reclaude`) and make
it the default. The wrapper's absolute path is a machine fact → the gitignored `spexcode.local.json`; the
portable default NAME → the committed `spexcode.json`:

```
// spexcode.local.json (gitignored, host-specific)
{ "sessions": { "launchers": {
    "reclaude": { "harness": "claude", "cmd": "/abs/path/to/reclaude --dangerously-skip-permissions" } } } }

// spexcode.json (committed, portable)
{ "sessions": { "defaultLauncher": "reclaude" } }
```

Gotchas worth knowing:
- **Losing the local launcher config is the usual cause of a sudden 401 wave.** `spexcode.local.json` is
  gitignored, so anything that clobbers the checkout's untracked files (a wiped worktree, a fresh clone, an
  overzealous cleanup) silently drops the wrapper definitions — every **new** worker falls back to whatever
  the committed default resolves to (bare `claude`) and 401s, while already-running workers keep their good
  launch. Restore the JSON and the next dispatch is healthy — no restart.
- An already-401'd worker does **not** recover via `resume` — the launcher command is **pinned on the
  session record at creation**, so resume replays the same broken command even after you fix the config.
  **Close it, kill its tmux session (`tmux -L spexcode kill-session -t <id>`), then re-dispatch.**
- This is distinct from a *genuine* token expiry (which needs **you** to re-login). The tell: your
  interactive Claude Code works and only dispatched workers fail → launcher config wrong or missing, not a
  dead token.

## Setup / onboarding

The pre-commit hook is **per-clone, not committed** (`.git/hooks/` is never in the repo), so a fresh
clone must install it once — that's the answer to "when do we set up the hook": **at onboarding, right
after install, before the first commit.**

1. `npm install` in each package you use (`spec-cli`, `spec-dashboard`).
2. `npm run hooks` — copies `spec-cli/templates/hooks/*` into the shared git hooks dir (covers every
   worktree). Re-run it whenever the hook source changes.

The hook is **advisory** — bypassable, and absent on any machine that skipped step 2. The real gate is
**CI running `spex spec lint`**; treat the hook as fast local feedback, CI as enforcement.

Adopting SpexCode on an existing project (no restructure needed — the layout seam handles where things
live):

1. Add `.spec/<area>/spec.md` nodes for the parts you want governed, each with a `code:` list pointing
   at the existing files.
2. `npm run hooks`.
3. Run `spex spec lint` — the **coverage** warnings are your adoption TODO: every source file not yet
   claimed by a spec. Work the list down; promote coverage to an error once the graph is complete.
4. If your layout differs from the default (main at root, worktrees in `.worktrees/`, `node/<id>`
   branches), drop a `spexcode.json` to point the tool at your structure instead of forking it.

`spex init` does steps 1–4's scaffolding in one shot: it seeds a starter `.spec/` tree (a root `project`
node + the default `.config` plugins), plants a starter `spexcode.json`, installs the hooks, and
**materializes** the harness artifacts — the `<!-- spexcode -->` contract block in `CLAUDE.md`/`AGENTS.md`
(this guide's prose FOLLOWED BY the `surface: system` config bodies, which the harness auto-discovers) and
the `.claude`/`.codex` shims (the `settings.json` hooks). Those materialized artifacts are **generated and
never tracked** (hidden via the per-clone `.git/info/exclude`) — regenerated per clone, kept fresh by the
git-native anchors (an unconditional materialize in pre-commit, plus post-checkout/post-merge refreshes;
no harness event ever triggers a materialize) — so a
fresh clone re-runs `spex init`/`spex materialize` rather than pulling them from git. This is the same
materialize that makes a self-launched agent already know the whole dev flow; the settings an agent tunes after
adoption (launchers, dashboard icon, lint budgets) all live in those two `spexcode.json` /
`spexcode.local.json` files, documented in full by **`spex guide config`**.

## Naming

The project is **SpexCode**. npm root package: `spexcode`; CLI package: `@spexcode/spec-cli`. The
package *directory* names (`spec-cli`, `spec-dashboard`, `spec-forge`) are component
names and stay lowercase-hyphen — they are not the brand. Env escape hatch: `SPEXCODE_ALLOW_MAIN`.
Optional layout override file: `spexcode.json`.
