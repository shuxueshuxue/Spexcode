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

SpexCode is **two layers**, and you can stop after the first:

- **The governance layer** — `spex init`, `spex lint`, the spec tree, and the read-only dashboard. This
  is pure spec-and-git tooling: **no AI, no extra services.** Node and git are all it needs.
- **The self-developing session layer** — dispatching AI workers onto nodes, with the board's live
  terminals. This shells out to the **[Claude Code](https://www.anthropic.com/claude-code) CLI**
  (launched as `claude --dangerously-skip-permissions`, overridable via `SPEXCODE_CLAUDE_CMD`) and
  **tmux**. If you create a session without those installed and authenticated, it will fail.

> **Requirements.** Governance layer: **Node ≥ 22** and **git**. Session layer additionally needs
> **tmux** and an authenticated **Claude Code** CLI on your PATH. Sessions also run an agent that can
> execute commands on your machine — read [`SECURITY.md`](./SECURITY.md) before exposing the backend.

You don't clone this repo to *use* SpexCode. Install the published CLI once, then point it at any project.

```sh
npm i -g spexcode      # installs the `spex` command (needs Node ≥ 22)
```

Adopt it in your project — `spex init` is **additive**, it never restructures your code:

```sh
cd ~/my-app
spex init              # seed .spec/, a starter spexcode.json, and git hooks — nothing destructive
# 1. edit .spec/project/spec.md to describe your project
# 2. point spexcode.json's  lint.governedRoots  at your real source dir(s)
spex lint              # the "coverage" warnings are your adoption TODO list
```

Run it. The backend and the dashboard are **two commands on two ports**, so several projects can run
side by side on one host (the cwd picks which project is served):

```sh
spex serve --port 8788                       # the backend (API + sessions) for THIS repo
spex dashboard --port 5174 --api-port 8788   # the board UI, pointed at that backend
```

Then open <http://localhost:5174>. With no flags, `spex serve` defaults to `:8787` and `spex dashboard`
to `:5173`.

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

The contribution ritual in one breath: branch `node/<id>` off `main`, make the code change **and** its
`spec.md` *together*, commit, then `spex session done --propose merge` — a human performs the `--no-ff`
merge. That ritual, the spec-node model, the lint rules, and the reflexive config system are all spelled
out in **[`CLAUDE.md`](./CLAUDE.md)** — read it before your first change.

The human-facing version of all that — setup, the ritual, what "good" looks like — is in
**[`CONTRIBUTING.md`](./CONTRIBUTING.md)**.

---

## Project status & known limitations

SpexCode is **pre-1.0 and dogfooded daily**, not yet battle-tested across many outside projects. Being
honest about the edges so you can decide if it fits:

- **Vendor-coupled at the session layer.** The self-developing features assume the
  [Claude Code](https://www.anthropic.com/claude-code) CLI. The launcher is swappable
  (`SPEXCODE_CLAUDE_CMD`), but there's no first-class adapter for other agents yet. The **governance
  layer is fully usable without any of this** — that's the part to try first.
- **Single-operator, localhost-first.** The backend and dashboard have **no auth layer** and the
  session console is a live terminal. Don't put either on an untrusted network without your own
  authenticated tunnel — see [`SECURITY.md`](./SECURITY.md).
- **The git hook is advisory, not a hard gate.** It's per-clone (re-run `npm run hooks` after a fresh
  clone) and bypassable. The intended enforcement is CI running `spex lint`; wiring that into your own
  repo is on you for now.
- **Sessions need tmux**, so the session layer is Unix-oriented (macOS / Linux). The governance layer
  is cross-platform.
- **Packaging is young.** Early `spexcode` releases shipped install bugs that only a clean-room install
  catches; if `spex` misbehaves right after `npm i -g`, please file an issue with your Node version and
  OS.

If a limitation here blocks you, an [issue](https://github.com/shuxueshuxue/spexcode/issues) is the
fastest way to tell us which one matters.

---

## License

[MIT](./LICENSE).
