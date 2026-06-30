---
title: portable-layout
status: active
session: sess-merge
hue: 160
desc: Where things live — main, worktree→node mapping, the spec root node — is detected policy, never a baked-in name.
code:
  - spec-cli/src/layout.ts
  - spec-cli/src/layout-session-id.test.ts
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

The same `spexcode.json` (read through `readConfig`) is also where adjacent project policy is DECLARED rather
than baked in — including the `harnesses` delivery-target set [[harness-select]] owns (which harnesses `spex
materialize` renders into; default = every native harness). Layout resolution doesn't consume it, but it rides
the same committed-config-with-a-`spexcode.local.json`-overlay seam: persistent, re-read on every materialize.

The **source-of-truth branch** — what worktrees fork from, merges land on, and reviews diff against — is
detected by `mainBranch()`, never the baked-in name `main`: the `mainBranch` override above wins, else the
branch the main checkout is currently on (so an adopted repo whose default is `staging`/`feat-x` just works
with no config), else `main`. This single resolution is surfaced two ways downstream — `GET /api/layout`
for the dashboard and `spex trunk` (one line, for shell consumers like the [[main-guard]] pre-commit hook,
which asks "is HEAD the trunk?" instead of hardcoding `main`). Both resolve via the shared git **common**
dir, so they answer identically from the main checkout, a linked worktree, or a commit hook:
`mainCheckout()` exposes the root working tree itself
(`dirname` of the common dir), which a harness keying a per-PROJECT artifact to the root checkout uses — e.g.
Codex's hook shim + trust materialize at `mainCheckout(proj)`, not the worktree (see [[harness-adapter]]).

A managed session's node id comes from its global **record** (`node`, the ref the session was bound to —
which the branch slug's `-<id4>` suffix can't give), falling back to the branch (strip `branchPrefix`) when
absent. Beyond resolution, the seam produces the board's raw
material: for each governed record it computes that worktree's pending spec-node changes vs main (`ops`,
consumed by [[sessions]]' `buildBoard`) — the board ENUMERATES the global store (filtered to `governed:true`),
NOT `git worktree list`, so an unmanaged scratch worktree (`agent-*`) never appears.

Because the record left the worktree, an agent's `spex session done/park/ask` finds its OWN session in the
ENVIRONMENT (`envSessionId()`), with a harness-aware precedence: a harness's per-thread env var
(`sessionEnvVar`) that ALIASES to a governed record (via `harness_session_id`, [[runtime]]) beats
`SPEXCODE_SESSION_ID`. Codex needs this — its ONE shared per-project app-server ([[harness-adapter]]) runs
the agent's shell under the FIRST session's baked `SPEXCODE_SESSION_ID`, while codex injects the acting
thread's `CODEX_THREAD_ID` per command, which aliases correctly. Claude is unchanged (its env var already
equals its record id); a raw, un-aliased harness id is the last resort, below `SPEXCODE_SESSION_ID`.

The same *policy-not-hardcode* rule governs where the config loaders look. The spec tree's **root
node** — the single top-level directory under `.spec/` that holds a `spec.md` — is detected at read
time, never assumed by name: the dogfood repo's is `spexcode`, a `spex init` adopter's is `project`. So
[[source-of-truth]]'s `specs.ts` resolves the two config roots (`<root>/.config` and `<root>/config`,
scanned by `loadSurface` per [[surface]]) from that *detected* root, not a baked-in `spexcode`. Without
it an adopter's `loadSystemConfig` finds nothing — the `.config/core` contract never loads, launched agents
get no system prompt — so portability is only real when the config root travels with the rename.

The reproducibility contract is concrete: `.nvmrc` pins Node (22) and both package-locks are tracked, so
installs are deterministic. Machine-local artifacts never enter the tree: the worker launcher resolves
env `SPEXCODE_CLAUDE_CMD` → a gitignored `spexcode.local.json` (`readConfig` overlays it on committed
`spexcode.json`) → the default, so a host-specific launcher path has a *durable* home surviving restarts,
never committed. A launch generates NO per-session SpexCode files in the worktree: the
record and the launcher products (prompt, launch, launch.sh, recorded comms) live in the per-user global
store ([[runtime]]), keyed by session_id, outside the tree — so nothing per-session is left to ignore or
commit (the contract instead reaches the agent by materializing into the worktree's OWN tracked
`CLAUDE.md`/`AGENTS.md`, not by hiding it into the store — see [[harness-delivery]]). No absolute machine
path is baked anywhere in the checkout.
