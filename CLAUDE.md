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

**Why a dispatched worker is never told the ritual.** This file (`CLAUDE.md`) is auto-loaded only by
the *managing* session; a dispatched worker runs with it **hidden** (`hideClaudeMd`) and gets a
**task-only** prompt. The ritual still reaches the worker through product *mechanism*, not prose: the
backend creates the `node/<id>` branch, the `prepare-commit-msg` hook stamps the `Session:` trailer,
the commit-before-declare contract is the **`.config/core`** node folded into the worker's
`--append-system-prompt` (there is no baked `CORE_CONTRACT` constant — the contract is *data*, a
config node), and the `--no-ff` merge style is stated at merge time by the merge prompt. So don't
restate the flow when dispatching — the system enforces it.

`main-guard` (a pre-commit hook) **blocks direct commits on `main`**; merges pass because `MERGE_HEAD`
is set, and node-branch commits pass because they aren't on `main`. Escape hatch for seeding/topology
only: `SPEXCODE_ALLOW_MAIN=1 git commit …`. Install/repair the hook with `npm run hooks` — **re-run it
after the hook source (`spec-cli/templates/hooks/pre-commit`) changes**, since `.git/hooks/pre-commit`
is a copy. That `templates/hooks/` dir is the single canonical source `spex init` plants too.

Convention for live work: worktrees in `.worktrees/`, branch `node/<id>`, plus an untracked `.session`
file (`node:` / `session:` / `status:` lines) that the layout linker reads.

## Supervising — the manager loop

If you're the **managing session** (you read this file), you're a **manager**, not a worker. Don't
write feature code and don't deep-read source — that's what workers are for. Read the goal node and
this loop, then **dispatch immediately**: decompose the goal into spec-node-sized tasks and delegate
each. There is no discovery phase.

- **DISPATCH** — `spex new "<task>" --node <id>` launches one worker. Give it **only its task**; the
  whole contract (the dogfood ritual, the commit-before-declare gate, the merge style) reaches it
  through its own system prompt and the product mechanism — don't restate any of it. One independent
  feature per node.
- **PARALLELIZE** — dispatch independent nodes **concurrently**. That parallelism is the core payoff
  of spec-driven dev, so reach for it; don't serialize out of caution. Contention on `main` is fine —
  git serializes the merges, and a conflict just means you re-merge. Never throttle parallel work to
  avoid conflicts.
- **MONITOR** — `spex watch` streams the session lifecycle: `launched` → actionable transitions
  (`review` / `done` / `offline` / `error` / `needs-input`) → `closed`. A booting worker reads
  `starting` (not `offline`) until its control socket is up, and `closed` fires only when a session is
  genuinely gone — so each event is trustworthy and needs no cross-checking against git.
- **WAIT WITH `spex wait <id>`** — to wait on a dispatched worker, background `spex wait <id>`: it blocks
  until the worker hits an actionable status, prints it, and **exits** (the exit is your wake-up — the
  harness re-invokes you when the backgrounded command finishes). It **draws the watcher→worker edge on the
  session graph** for the whole wait (so your supervision is visible, not an invisible spin) and is
  **guaranteed to terminate** (a `--timeout`, default 1200s, is the hard wall — a worker stuck in any
  non-actionable state can't hang you). Background one wait per worker; N waits draw N edges. One trap:
  **never block on `spex watch`** — that's the human's *forever* stream, no `<id>`, and it freezes your turn.
  (`spex review <id>` / `spex ls` still return a one-shot snapshot; `spex board` dumps the board JSON for a glance.)
- **REVIEW** — `spex review <id>` prints the one review payload: commits ahead of `main`, the
  merge-base diff (the worker's real changes), and the merge/typecheck/lint gates. Decide from that —
  you don't hand-run git or read the source.
- **MERGE** — `git -C <root> merge --no-ff <branch>`. Then **confirm the merge landed**: `git -C <root>
  log -1` must show `HEAD` advanced to the new merge commit **before** you go any further. Never close
  an unmerged branch — closing discards the work.
- **CLOSE** — only **after** the merge is confirmed: `spex session close <id>`.
- **GUIDE** — `spex session send <id> "<msg>"` corrects or steers a live worker. Keep `spex lint` at
  **0 errors** across the tree.
- **FOOTGUN** — `spex session new --help` is **not** a help flag: it CREATES a stray session. Always
  dispatch with `spex new`.

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
  *instance* plugins (`core` + `forge-link` + `voice-before-ask` are `surface: system`; `health` +
  `supervisor` + `tidy` are `surface: slash`); **`config`** holds the *spec of
  the config system* itself (`surface`). Each plugin is a **flat** child carrying a `surface`
  frontmatter **field** — `surface: system` folds its body verbatim into every launched agent's
  `--append-system-prompt`; `surface: slash` exposes it as a `/`-dropdown preset for new sessions.
  There are no `system/`/`slash/` bucket dirs and no path-driven surface — the surface *is* the field,
  so every plugin is a real graph child. `spec-cli`'s `loadSystemConfig`/`loadConfig` gather the two
  surfaces; only built/active plugins gather (a `pending` plugin renders on the board but reaches no
  surface).
- `spec.md` = frontmatter (`title`, `status` ∈ merged|active|pending, `session`, `hue`, `desc`,
  optional `code:` list; config nodes also carry a `surface` field) + a markdown body.
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
  Reads `.spec` + git live. The dashboard's single source is **`GET /api/board`** (assembled
  tree + overlay + sessions); other surfaces include `GET /api/specs`, `GET /api/specs/:id/history`
  (+ `/diff/:hash`), `GET /api/layout`, `GET /api/config` (the gathered config surfaces),
  `GET /api/slash-commands`, and the whole **`/api/sessions` state-machine** (list/create/review/
  merge/resume/capture/prompt/close + the **`:id/socket` terminal WebSocket** and `graph` edges).
  Loader: `src/specs.ts`; git access: `src/git.ts`; sessions/launch: `src/sessions.ts`;
  portability seam: `src/layout.ts` (`resolveLayout()`, optional `spexcode.json` override for
  non-default layouts).
- `spec-dashboard/` — Vite + React. `src/data.js`'s `loadBoard()` fetches **`/api/board`**; the x/y
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
- Frontend: `npm run web` → Vite. **Port 5173 by default but not pinned** — it takes the next free
  port (e.g. 5174) and prints `Local: http://localhost:<port>/`; read that line for the real port.
  Vite proxies `/api` → :8787, so the backend must be running too.
- `spex watch` — the **canonical session monitor**: streams actionable session transitions as they
  happen (`spex ls` for a one-shot table). The dashboard's live Sessions console is the GUI
  equivalent.
- `spex lint` (CLI: `spec-cli/src/cli.ts` → `lint.ts`; or `npm run lint`) checks the spec↔code graph:
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
SPEXCODE_CLAUDE_CMD='/abs/path/to/reclaude --dangerously-skip-permissions' npm run api
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
2. `npm run hooks` — copies `spec-cli/templates/hooks/*` into the shared git hooks dir (covers every
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
package *directory* names (`spec-cli`, `spec-dashboard`, `spec-forge`) are component
names and stay lowercase-hyphen — they are not the brand. Env escape hatch: `SPEXCODE_ALLOW_MAIN`.
Optional layout override file: `spexcode.json`.

<!-- spexcode:start -->
Before you touch code — and merely READING it counts, not only editing — READ THE GOVERNING SPEC'S BODY first: open the `spec.md` and read its actual PROSE, not the title, not the one-line desc, not your memory of it. The body is the current contract. Don't already know which node governs what you're about to touch? FIND IT WITH `spex search <topic>` — not grep: grep finds code by architectural centrality, search finds intent by user-story, so grepping first under-discovers exactly the user-facing behaviour the spec foregrounds (for a find-by-story question a keyword can't reach, `spex search --deep <topic>`). A node rarely stands alone, so READ ITS NEIGHBORS' BODIES TOO — the parent that scopes it, the siblings it shares a boundary with, the children that refine it — a node's intent is only fully legible against the tree around it. Code and its comments tell you what the code DOES; only the spec tells you what it is SUPPOSED to do — reaching for code before the spec is the exact habit this rule exists to break. Then act deliberately: if your task changes the intent, edit the spec first so spec and code land together; if it implements existing intent, make the code honor the spec. The one forbidden move is code that silently diverges from its spec.

Commit your spec node and the code it justifies BEFORE you declare done or propose merge — the commit comes first, never as an afterthought to a declaration.

A spec body is a living current-state document: it states the node's PRESENT intent and is rewritten in place. Never accrete a "## vN" changelog heading, and never add current-state or verdict sections — version history is git's job, not the body's.

An independently-scoped feature gets its OWN spec node: if you build something separately scoped while working, create a sibling node for it rather than bundling it into your assigned node's commit (cosmetic polish riding along is the smell).

Keep the loss signal honest for what you changed — yatsu is the signal the optimizer reads, so a gap is a blind spot. Changed a node that carries a `yatsu.md`? Re-measure it: run its scenario, compare to the expected, and file the result with `spex yatsu eval <node>`. Made an obvious frontend change to a node with NO `yatsu.md`? Give it one — a scenario (description + expected) — so its loss can be measured. `spex yatsu scan --changed` shows the gaps in exactly the nodes you touched.

Don't reverse-engineer the file formats: `spex guide spec` and `spex guide yatsu` print the full spec.md and yatsu.md schema on demand. This prompt is the clue; that manual carries the detail.

When you open a GitHub issue, link it to the spec node(s) it serves by adding a line to the issue **body**: `Spec: <node-id>` (comma-separate several). The id is the node's **leaf** name — the folder under `.spec/…/<id>/spec.md`, e.g. `sessions`, never the slash-path. An unrecognized id silently links nothing, so use a real node id (`spex board` lists them). A pull request needs no marker: opening it from your `node/<id>` branch links it for free.

## Memory hygiene — keep the shared store identity-clean

SpexCode's agent memory is keyed by the **main project**, so every agent running under this project — the main checkout AND every worktree — reads the **same** memory. That makes session- and role-specific facts toxic: one agent's note silently becomes every agent's belief. So, when deciding whether to record a memory:

- **Never record session-specific content** — this task, this worktree's transient state, a one-off decision, who you're talking to right now. Memory is ONLY for durable, cross-session project/user facts.
- **On a non-main worktree** (you are on a `node/<id>` branch, not the main checkout): do **not** record any memory for this session at all. Its work is transient and will merge or close; a durable lesson is recorded later, from main, once it has actually landed.
- **Even on main, never record a transient ROLE or IDENTITY** — "I am the supervisor", "I'm the coordinator", "I'm the agent doing X". These are per-launch facts, not durable ones. Recording one makes the next launched agent read *itself* as that role, and several agents in one folder dissolve into mutual-supervision confusion (everyone thinks they're the supervisor, everyone watches everyone).

Sanity-check yourself; don't confabulate. The moment you notice you're making something sound good — a clever framing, a tidy rationalization, a confident summary — stop and ask: is this actually *true*? is it actually *good*? Prefer naming a smell, or saying plainly "I'm not sure" or "this might be wrong", over a polished justification that papers over the doubt.

Don't accept or echo a claim just to be agreeable, or to clear a gate. Verify it first; if you can't, say so and mark it unverified. Facts outrank politeness, including toward the human and toward other agents.

Be most suspicious of the outputs you are most pleased with — a description that flatters a design is exactly where a smell hides behind good prose.

Before asking the human a question (via `AskUserQuestion` or `spex session ask`), first speak it aloud through the voice MCP (`voice/say`). A human who isn't watching the text must never be left blocked on an unspoken prompt.
<!-- spexcode:end -->
