---
title: guide
status: active
hue: 200
desc: `spex guide` prints the product setup workflow — install the CLI once, then an agent drives the rest.
code:
  - spec-cli/src/cli.ts
---
# guide

`spex guide` is the product's onboarding surface as a **command**, not buried docs: it prints the
end-to-end workflow for running SpexCode on *your own* repo. The model it teaches is **install the
CLI once, then let an agent drive** — the human's only manual steps are the global install and
pointing at a repo; authoring spec nodes, wiring the dashboard, and the dogfood ritual are an
agent's job.

Each step names the real seam rather than restating internals:

- **cwd is the "which repo" knob** — `spex` and `spex serve` always operate on the git repo of the
  current directory, so serving a different repo just means running from there (two repos at once =
  two `spex serve` on two `PORT`s).
- **`API_URL` is the dashboard's endpoint seam** — the dev server proxies `/api` to whatever backend
  it names, so the dashboard points at whichever `spex serve` you ran.
- **`spexcode.json` governs layout** — lint's `governedRoots`/`sourceExtensions` and any non-default
  worktree convention; `spex lint` at 0 errors is the adoption bar, its coverage warnings the TODO.

The text is help narration (like `printHelp` and `spex init`'s next-steps), so it lives in the CLI
source — it is *not* a planted `.spec` template the way [[spex-init]]'s contracts are. `guide` tells
you the loop; [[spex-init]] performs the first step of it.
