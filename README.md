<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development fails two ways: the spec drifts out of sync with the code, or it
> bloats into stale ceremony. SpexCode keeps each spec short and current — rewritten in place,
> versioned by git, never an accumulating changelog.

**SpexCode** is a spec-driven, self-developing dev tool. Every part of a project becomes a versioned
*spec node* — a `.spec/**/spec.md` whose body states the part's *present* intent — and **git is the
database**: a node's version is its count of content commits, and "drift" is governed code that moved
ahead of its spec. A `spex` CLI plus a live dashboard read all of it straight from git; there is no
separate store.

Pick the path that fits — most people want the first:

- **[Using SpexCode](#using-spexcode)** — install the `spex` CLI from npm and govern *your own* project.
- **[Contributing to SpexCode](#contributing-to-spexcode)** — hack on the tool itself, in this repo.

---

## Using SpexCode

You install the `spex` CLI and point it at your own repo. At its core that's plain tooling: **spec files
versioned by git**, checked by `spex lint` and shown on a read-only dashboard — no AI, and nothing to run
but Node and git.

Optionally, SpexCode can dispatch AI coding agents (**[Claude Code](https://www.anthropic.com/claude-code)**
or **Codex**) onto your spec nodes and stream their live terminals on the board — that part also needs
**tmux** and the agent CLI on your PATH.

> **Requirements.** Core: **Node ≥ 22** and **git**. Dispatching AI agents also needs **tmux** and an
> authenticated **Claude Code or Codex** on your PATH — and those agents run commands on your machine, so
> read [`SECURITY.md`](./docs/SECURITY.md) before exposing the backend.

Install the published CLI once, then point it at any project:

```sh
npm i -g spexcode      # installs the `spex` command (needs Node ≥ 22)
```

Adopt it in your project — `spex init` is **additive**, it never restructures your code:

```sh
cd ~/my-app
spex init              # seeds .spec/, a starter spexcode.json, and git hooks — nothing destructive
```

Then make it yours: edit `.spec/project/spec.md` to describe the project, and point `spexcode.json`'s
`lint.governedRoots` at your real source dir(s). Now check the graph:

```sh
spex lint              # the "coverage" warnings are your adoption TODO list
```

Run it — start the backend and the dashboard, then open the board:

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

Day to day:

| command | what it does |
| --- | --- |
| `spex lint` | check the spec↔code graph — coverage, drift, and the living-body rules |
| `spex watch` | stream session / board transitions as they happen |
| `spex guide` | print the full workflow, plus the `spec.md` / `yatsu.md` file-format manuals |
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

The contribution ritual: branch `node/<id>` off `main`, make the code change **and** its `spec.md`
*together*, commit, then `spex session done --propose merge` — a human performs the `--no-ff` merge. The
full contract — that ritual, the spec-node model, the lint rules, the reflexive config system — is in
**[`docs/AGENT_GUIDE.md`](./docs/AGENT_GUIDE.md)** (read it before your first change);
**[`CONTRIBUTING.md`](./docs/CONTRIBUTING.md)** is the human-oriented walkthrough.

---

## License

[MIT](./LICENSE).
