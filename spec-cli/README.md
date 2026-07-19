<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development gets wrecked by spec drift and spec bloat. SpexCode's bet
> is to keep the spec the cheap, honest twin of the code — rewritten in place, never
> a tuxedo of stale ceremony.

**SpexCode** is a spec-driven, self-developing dev tool. Every part of a project becomes a versioned
*spec node* — a `.spec/**/spec.md` whose body states the part's *present* intent — and **git is the
database**: a node's version is its count of content commits, and "drift" is governed code that moved
ahead of its spec. A `spex` CLI plus a live dashboard read all of it straight from git; there is no
separate store.

There are two ways to meet SpexCode, and they are kept separate on purpose:

- **[Using SpexCode](#using-spexcode)** — install the `spex` CLI from npm and govern *your own* project.
- **[Contributing to SpexCode](#contributing-to-spexcode)** — develop the tool itself, in this repo.

---

## Using SpexCode

You don't clone this repo to *use* SpexCode. Install the published CLI once, then point it at any project.

```sh
npm i -g spexcode      # installs the `spex` command (needs Node ≥ 22)
```

Adopt it in your project — `spex init` is **additive**, it never restructures your code:

```sh
cd ~/my-app
spex init --harness claude  # seed .spec/, starter config, hooks, and the agent contract
# 1. edit .spec/project/spec.md to describe your project
# 2. point spexcode.json's  lint.governedRoots  at your real source dir(s)
spex spec lint         # the "coverage" warnings are your adoption TODO list
```

Run one backend from every project you want online. Each successful `spex serve` publishes its
endpoint to the current user's host registry; additional projects only need a free backend port:

```sh
spex serve              # this project's backend (API + sessions), default :8787
# In another project: spex serve --port 8788
```

In another shell, start the host gateway/UI once for the current user:

```sh
spex dashboard          # shared dashboard, default :5173
```

Open <http://localhost:5173/projects>. The gateway automatically discovers backends already running
and those started later. `/projects` is the global project switcher and management surface; project
dashboards live under `/p/:id/`. There is no per-project UI process or API/UI port pairing.

Day to day:

| command | what it does |
| --- | --- |
| `spex spec lint` | check the spec↔code graph — coverage, drift, and the living-body rules |
| `spex session watch` | stream session transitions as they happen |
| `spex guide` | print the setup workflow; topics cover the `spec.md` and `eval.md` formats |
| `spex graph --json` | dump the current assembled view as JSON |

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

The development loop runs from source with hot reload:

```sh
npm run api            # backend on :8787, hot-reloads on spec-cli/src changes
npm run web            # the dashboard via Vite (HMR), proxying /api → :8787
```

These are contributor-only source commands. Installed users run `spex serve` in each project and one
`spex dashboard` for the host; they do not run the Vite development server.

The contribution ritual in one breath: branch `node/<id>` off `main`, make the code change **and** its
`spec.md` *together*, commit, then `spex session done --propose merge` — a human performs the `--no-ff`
merge. That ritual, the spec-node model, the lint rules, and the reflexive config system are all spelled
out in **[`CLAUDE.md`](./CLAUDE.md)** — read it before your first change.
