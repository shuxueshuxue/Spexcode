<img src="docs/sdd-tuxedo-pooh.png" alt="Writing code vs. authoring a living, executable specification artifact" width="420">

> Spec-driven development gets wrecked by spec drift and spec bloat. SpexCode's bet
> is to keep the spec the cheap, honest twin of the code — rewritten in place, never
> a tuxedo of stale ceremony.

## How to use

One install, then an agent drives the rest:

```sh
cd spec-cli && npm install && npm link   # the `spex` CLI — runnable from any repo
cd <your-repo> && spex init              # adopt: seed .spec/ + git hooks (additive)
spex serve                               # backend reads .spec + git from here (PORT=<n> to move it)
cd spec-dashboard && npm install && npm run dev   # the board (dashboard.apiUrl in spexcode.json points it)
```

`spex guide` prints the full workflow. From there the spec tree is ground truth and git is its
database: every change is a `spec.md` node, rewritten in place and versioned by its commits.
