<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development gets wrecked by spec drift and spec bloat. SpexCode's bet
> is to keep the spec the cheap, honest twin of the code — rewritten in place, never
> a tuxedo of stale ceremony.

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
> read [`SECURITY.md`](./SECURITY.md) before exposing the backend.

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

- **Harness-coupled, not vendor-locked.** The self-developing layer drives a coding-agent harness behind
  one adapter seam; **Claude Code and Codex are both first-class** today (the launcher picks one;
  `SPEXCODE_CLAUDE_CMD` overrides it). A harness with no adapter yet would need one written — that's the
  only coupling. The **governance layer is fully usable with no harness at all** — that's the part to try
  first.
- **Localhost-first; remote access is opt-in and password-gated.** By default the backend and dashboard
  bind to loopback with **no gate** — loopback is the trust boundary. To reach them from another machine,
  `spex serve --public --password <pw>` raises a password-gated TLS gateway (a styled login + signed
  cookie, the terminal socket included), or put your own authenticated tunnel in front. The session
  console is a live terminal, so never expose a bare unauthenticated port — see [`SECURITY.md`](./SECURITY.md).
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
