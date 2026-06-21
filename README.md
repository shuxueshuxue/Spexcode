<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development gets wrecked by spec drift and spec bloat. SpexCode's bet
> is to keep the spec the cheap, honest twin of the code — rewritten in place, never
> a tuxedo of stale ceremony.

## How to use

Install SpexCode **once** — this one checkout drives all your projects:

```sh
cd spec-cli && npm install && npm link   # the global `spex` CLI — now runs in ANY repo
cd spec-dashboard && npm install         # the board — a viewer you point at any backend
```

Then per project (the `spex` CLI always acts on the repo you're in):

```sh
cd ~/my-app && spex init                 # adopt: seed .spec/ + git hooks (additive)
spex serve                               # backend serves THIS repo (PORT=<n> for a second project)
API_URL=http://localhost:8787 npm --prefix <spexcode>/spec-dashboard run dev   # open the board on it
```

One `spex serve` + one board = one project; launch another pair (another `PORT`/`API_URL`) for the
next. `API_URL` is how the shared board points at each project; `spexcode.json`'s `dashboard.apiUrl`
is the default only when the board lives *inside* the project (the dogfood layout).

`spex guide` prints the full workflow. The spec tree is ground truth and git is its database: every
change is a `spec.md` node, rewritten in place and versioned by its commits.
