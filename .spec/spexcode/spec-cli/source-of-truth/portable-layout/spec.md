---
title: portable-layout
status: active
session: sess-merge
hue: 160
desc: Layout (where main is, how worktrees map to nodes) is an external interface, not a hardcode.
code:
  - spec-cli/src/layout.ts
---
# portable-layout

## raw source

Our convention — main at the repo root, worktrees in `.worktrees/`, branch `node/<id>` + an untracked
`.session` file — should be the *default plug*, not an assumption baked into the tool. **Mechanism vs
policy:** reading `.spec` and `git log` is mechanism; *where those live* is policy. Someone whose main
lives elsewhere, or who names branches differently, should point the tool at their structure without
forking it.

## expanded spec

`spec-cli/src/layout.ts` is the one seam. `resolveLayout()` answers three questions — where is main,
how to enumerate the other checkouts, how each declares its node — and exposes the result at
`GET /api/layout`. Everything downstream consumes the resolved layout, never a hardcoded path.

Policy is read from an optional `spexcode.json` at the repo root; absent, the defaults are our
convention:

```json
{ "main": "/elsewhere", "branchPrefix": "node/", "nodeFrom": "branch" }
```

A worktree's node id resolves from its branch (strip `branchPrefix`) or its `.session` file, per
`nodeFrom`. Beyond resolution, the seam also produces the board's raw material: each worktree carries
its pending spec-node changes vs main (`ops`, the overlay [[sessions]]' `buildBoard` consumes). To keep
that cheap and honest, only **managed** SpexCode worktrees (a `.session` label or a `node/*` branch)
get a spec delta — harness scratch worktrees (e.g. `agent-*`) are skipped, both to keep them off the
board and to stop their large diffs dominating `/api/layout` latency; the per-worktree deltas are
computed in parallel.
