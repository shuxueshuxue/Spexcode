<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development fails two ways: the spec drifts out of sync with the code, or it
> bloats into stale ceremony. SpexCode keeps each spec short and current — rewritten in place,
> versioned by git, never an accumulating changelog.

**SpexCode** is a spec-driven, self-developing dev tool. Every part of a project becomes a versioned
*spec node* — a `.spec/**/spec.md` whose body states the part's *present* intent — and **git is the
database**: a node's version is its count of content commits, and "drift" is governed code that moved
ahead of its spec. A `spex` CLI plus a live dashboard read all of it straight from git; there is no
separate store.

- **[Using SpexCode](#using-spexcode)** — adopt the `spex` CLI and drive it through your coding agent to govern *your own* project.
- **[Contributing to SpexCode](#contributing-to-spexcode)** — hack on the tool itself, in this repo.

---

## Using SpexCode

You set SpexCode up once — `npm i -g spexcode` then `spex init` in your repo — and after that the primary
way you use it is **by talking to your coding agent**. You describe what you want in plain language —
*"add a spec node for the auth flow", "extract specs for this package", "dispatch a worker to implement
Y"* — and the agent runs the `spex` CLI for you while you supervise on the board. The manual CLI below is
the substrate; your agent is the daily interface.

That works because a freshly-launched agent **already knows SpexCode**. `spex init` materializes the whole
contract — the spec-node ritual, the commit-before-declare gate, the merge style — into a
`<!-- spexcode -->` managed block in your repo's `CLAUDE.md`/`AGENTS.md`, which
**[Claude Code](https://www.anthropic.com/claude-code)** and **Codex** **auto-discover** as always-on
context (no `--append-system-prompt`, nothing to wire). From there the agent self-serves detail on demand
from the built-in manual — `spex guide` (the workflow), `spex guide spec` / `spex guide yatsu` (the file
formats), and `spex guide config` (every `spexcode.json` setting). You can literally say *"run `spex guide
config` and set me up a launcher"* and it will.

> **It's also just plain tooling.** Strip the agent away and the core is still useful on its own: **spec
> files versioned by git**, checked by `spex lint` and shown on a read-only dashboard — no AI, and nothing
> to run but Node and git. The vibe-coding path sits *on top* of that; it doesn't replace it.

> **Requirements.** Core: **Node ≥ 22** and **git**. Driving SpexCode through an agent (or dispatching
> workers onto your nodes) also needs **tmux** and an authenticated **Claude Code or Codex** on your PATH
> — and those agents run commands on your machine, so read [`SECURITY.md`](./docs/SECURITY.md) before
> exposing the backend.

### Set it up

Install the published CLI once, then adopt it in any project:

```sh
npm i -g spexcode      # installs the `spex` command (needs Node ≥ 22)
cd ~/my-app
spex init              # additive — never restructures your code
```

`spex init` is additive: it seeds a starter **`.spec/`** tree (a root `project` node plus the `.config`
plugins that define the dev flow), a starter **`spexcode.json`**, and the per-clone **git hooks**
(`main-guard`, which blocks direct commits to `main`, and a `prepare-commit-msg` hook that stamps each
commit's session attribution). It also **materializes** the harness artifacts that make the agent path
work: the `<!-- spexcode -->` contract block in `CLAUDE.md`/`AGENTS.md`, and the `.claude/` / `.codex/`
shims (the `settings.json` hooks) a self-launched agent discovers. Those artifacts are generated and
gitignored — regenerated on each machine, never committed.

Then make it yours — either ask your agent to, or do it by hand: edit `.spec/project/spec.md` to describe
the project, point `spexcode.json`'s `lint.governedRoots` at your real source dir(s), and check the graph:

```sh
spex lint              # the "coverage" warnings are your adoption TODO list
```

### Configure it

Two optional JSON files at the repo root hold every setting, split by portability — pick the right one and
that's the whole discipline:

- **`spexcode.json`** — *committed, portable*: layout, dashboard identity (`title` + `icon`), lint budgets,
  and launcher **names**. Facts that are true for the project.
- **`spexcode.local.json`** — *gitignored, host-specific*: absolute launcher command paths, cert/secret
  paths. Facts that are true for one machine.

There is no `spex config set` — you (or your agent) edit the files directly. **`spex guide config`** is the
authoritative manual for every field and which of the two files it belongs in.

### Run it

Start the backend and the dashboard, then open the board:

```sh
spex serve          # the backend (API + sessions), on :8787
spex dashboard      # the board UI on :5173, proxying /api to the backend
```

Open <http://localhost:5173>.

Both ports are flags (`spex serve --port 8788`, `spex dashboard --port 5174 --api-port 8788`), so you can
run several projects' boards side by side — the working directory picks which project each serves. Give
each tab its own identity in that project's `spexcode.json`: `dashboard.title` names it and
`dashboard.icon` sets the favicon — an emoji (`"🔭"`), an Iconify name (`"mdi:rocket-launch"`), or a URL,
nothing to download.

Day to day (the commands your agent runs for you — and that you can run yourself):

| command | what it does |
| --- | --- |
| `spex lint` | check the spec↔code graph — coverage, drift, and the living-body rules |
| `spex watch` | stream session / board transitions as they happen |
| `spex guide` | print the full workflow, plus the `spec.md` / `yatsu.md` / `config` manuals |
| `spex board` | dump the current board state as JSON |

The spec tree is ground truth and git is its database: every change is a `spec.md` node, **rewritten in
place** (never a `## vN` changelog) and versioned by its commits.

---

## Contributing to SpexCode

This repository *is* the SpexCode source, and it **dogfoods itself**: every change to the tool lands as a
spec node merged into `main`. Set up a checkout:

```sh
git clone https://github.com/shuxueshuxue/spexcode && cd spexcode
npm --prefix spec-cli install
npm --prefix spec-dashboard install
npm run hooks          # install the per-clone git hooks (main-guard + the session-stamp hook)
```

The development loop runs from source, with hot-reload — this is what `npm run web` is for, as opposed
to an installed user's `spex dashboard`:

```sh
npm run api            # backend on :8787, hot-reloads on spec-cli/src changes
npm run web            # the dashboard via Vite (HMR), proxying /api → :8787
```

---

## License

[MIT](./LICENSE).
