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

Our convention (main at the repo root, worktrees in `.worktrees/`, branch
`node/<id>` + untracked `.session`) should be the *default plug*, not an
assumption baked into the tool. Mechanism vs policy: reading `.spec` and `git log`
is mechanism; *where those live* is policy.

`spec-cli/src/layout.ts` is the one seam. `resolveLayout()` answers three
questions — where is main, how to enumerate the other checkouts, how each declares
its node — and exposes the result at `GET /api/layout`. Everything downstream
consumes the resolved layout, never a hardcoded path.

No `spexcode.json` => our convention. With it => adapt to any layout:

```json
{ "main": "/elsewhere", "branchPrefix": "node/", "nodeFrom": "branch" }
```

So someone whose main lives in a different folder, or who names branches
differently, points the tool at their structure without forking it.
