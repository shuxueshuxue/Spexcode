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

Our convention — main at the repo root, worktrees in `.worktrees/`, branch `node/<id>`, and the session's
record in the per-user global store ([[runtime]], NOT the worktree) — should be the *default plug*, not an
assumption baked into the tool. **Mechanism vs
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
{ "main": "/elsewhere", "mainBranch": "staging", "branchPrefix": "node/" }
```

The **source-of-truth branch** — what worktrees fork from, merges land on, and reviews diff against — is
detected by `mainBranch()`, never the baked-in name `main`: the `mainBranch` override above wins, else the
branch the main checkout is currently on (so an adopted repo whose default is `staging`/`feat-x` just works
with no config), else `main`. It is resolved via the shared git **common** dir, so it answers identically
whether called from the main checkout, a linked worktree, or a commit hook.

A managed session's node id comes from its global **record** (`node`, the authoritative ref a dashboard
session was bound to — which the branch slug, carrying a `-<id4>` suffix, cannot give), falling back to the
branch (strip `branchPrefix`) when the record has none. Beyond resolution, the seam produces the board's raw
material: for each governed record it computes that worktree's pending spec-node changes vs main (`ops`, the
overlay [[sessions]]' `buildBoard` consumes) — the board is built by ENUMERATING the global store (filtered to
`governed:true`), NOT by scanning `git worktree list`, so an unmanaged or scratch worktree (e.g. `agent-*`)
never appears and never has its large diff dominate `/api/layout` latency; the per-record deltas are computed
in parallel, keyed by the record's `worktree_path`.

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
is `.gitignore`d, not committed. A launch generates NO files in the worktree at all now: the record, the
generated launch/hook scripts, and the isolated project `CLAUDE.md` all live in the per-user global store
([[runtime]]), outside the tree — so there is nothing per-session left to ignore or accidentally commit. No
absolute machine path is baked anywhere in the checkout.
