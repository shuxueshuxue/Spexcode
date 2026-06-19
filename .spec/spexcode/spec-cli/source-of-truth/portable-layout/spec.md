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

## current state

### description

`layout.ts` implements `resolveLayout()`: it reads `spexcode.json` (silent `{}` on missing/parse-fail),
lists worktrees via `git worktree list --porcelain`, and for each builds a `Worktree`
(`path`/`branch`/`node`/`session`/`status`/`isMain`/`ops`). `node` resolves from the stripped branch
prefix or the `.session` file per `nodeFrom`; `readSession` parses the untracked `.session`
(`node`/`session`/`status`) — the [[worktree-linker]] half. `ops` is `worktreeSpecDelta(path, mainRef)`
only for managed worktrees (skipped for main and scratch checkouts), gathered with `Promise.all`. The
resolved `Layout` (`main`, `convention`, `worktrees`) is returned and served verbatim at
`/api/layout`. No path is hardcoded; absent `spexcode.json` yields the documented defaults.

### verdict — not drifted

`layout.ts` is this node's only governed file and this version re-anchors the contract to it: the
description above (`resolveLayout`, `spexcode.json`, `readSession`, the managed-only `ops` overlay) is the
honest read of `layout.ts` today, so the spec no longer lags. `layout.ts` is now owned here **exclusively**
— [[worktree-linker]], the read-side link that lives inside this same seam, no longer co-claims it, so the
seam's churn attributes to one node instead of two. [[sessions]] still owns what `buildBoard` does with
`ops`. The raw source (layout is an external interface with a default plug) still holds.
