---
title: portable-layout
status: active
session: sess-merge
hue: 160
desc: Where things live — main, worktree→node mapping, the spec root node — is detected policy, never a baked-in name.
code:
  - spec-cli/src/layout.ts
  - .nvmrc
---
# portable-layout

## raw source

Our convention — main at the repo root, worktrees in `.worktrees/`, branch `node/<id>` + an untracked
`.session` file — should be the *default plug*, not an assumption baked into the tool. **Mechanism vs
policy:** reading `.spec` and `git log` is mechanism; *where those live* is policy. Someone whose main
lives elsewhere, or who names branches differently, should point the tool at their structure without
forking it. A fresh clone reproduces the tool **identically** — the Node version is pinned, lockfiles
are tracked, and nothing machine-specific leaks into the tree — so a clean checkout never diverges from
"works on my machine".

## expanded spec

`spec-cli/src/layout.ts` is the one seam. `resolveLayout()` answers — where is main, **which branch is
its source of truth**, how to enumerate the other checkouts, how each declares its node — and exposes the
result at `GET /api/layout`. Everything downstream consumes the resolved layout, never a hardcoded path or
branch name.

Policy is read from an optional `spexcode.json` at the repo root; absent, the defaults are our
convention:

```json
{ "main": "/elsewhere", "mainBranch": "staging", "branchPrefix": "node/", "nodeFrom": "branch" }
```

The **source-of-truth branch** — what worktrees fork from, merges land on, and reviews diff against — is
detected by `mainBranch()`, never the baked-in name `main`: the `mainBranch` override above wins, else the
branch the main checkout is currently on (so an adopted repo whose default is `staging`/`feat-x` just works
with no config), else `main`. It is resolved via the shared git **common** dir, so it answers identically
whether called from the main checkout, a linked worktree, or a commit hook.

A worktree's node id resolves from its branch (strip `branchPrefix`) or its `.session` file, per
`nodeFrom`. Beyond resolution, the seam also produces the board's raw material: each worktree carries
its pending spec-node changes vs main (`ops`, the overlay [[sessions]]' `buildBoard` consumes). To keep
that cheap and honest, only **managed** SpexCode worktrees (a `.session` label or a `node/*` branch)
get a spec delta — harness scratch worktrees (e.g. `agent-*`) are skipped, both to keep them off the
board and to stop their large diffs dominating `/api/layout` latency; the per-worktree deltas are
computed in parallel.

The same *policy-not-hardcode* rule governs where the config loaders look. The spec tree's **root
node** — the single top-level directory under `.spec/` that holds a `spec.md` — is detected at read
time, never assumed by name: the dogfood repo's is `spexcode`, a `spex init` adopter's is `project`. So
[[source-of-truth]]'s `specs.ts` resolves the two config roots (`<root>/.config` and `<root>/config`,
scanned by `loadSurface` per [[surface]]) from that *detected* root, not a baked-in `spexcode`. Without
it an adopter's `loadSystemConfig` returned nothing — their `.config/core` contract never loaded and
their launched agents got no system prompt — so portability is only real when the config root travels
with the rename.

The reproducibility contract is concrete: `.nvmrc` pins Node (22) and is tracked; both package-locks
(`spec-cli/`, `spec-dashboard/`) are tracked, so installs are deterministic. Machine-local artifacts
never enter the tree — the `claude` binary the launcher drives is a per-machine install resolved from
`PATH` (override via `SPEXCODE_CLAUDE_CMD`), so the `spec-cli/bin/claude` symlink some installs leave
is `.gitignore`d, not committed. The per-worktree runtime files a launch generates — `.session`, the
generated launch/hook scripts, and the hidden `CLAUDE.spexhidden.md` copy `hideClaudeMd` renames
`CLAUDE.md` to so Claude Code won't auto-load it — are likewise ignored, never committed. No absolute
machine path is baked anywhere in the checkout.
