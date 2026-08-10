---
title: portable-layout
status: active
session: sess-merge
hue: 160
desc: Where things live — main, worktree→node mapping, the spec root node — is detected policy, never a baked-in name.
code:
  - spec-cli/src/layout.ts#resolveLayout
  - spec-cli/src/layout.ts#layoutDeltas
  - spec-cli/src/layout.ts#mainRoot
  - spec-cli/src/layout.ts#mainBranch
  - spec-cli/src/layout.ts#readJsonConfig
  - spec-cli/src/layout.ts#readUploadPolicy
related:
  - spec-cli/src/layout-session-id.test.ts
  - spec-cli/src/session-public-projection.api.test.ts
  - spec-cli/src/layout-overlay.api.test.ts
  - spexcode.json
  - spec-cli/templates/spexcode.json
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
result at `GET /api/settings` (its `layout` half). Everything downstream consumes the resolved layout, never a hardcoded path or
branch name.

Policy is read from an optional `spexcode.json` at the repo root; absent, the defaults are our
convention:

```json
{ "main": "/elsewhere", "mainBranch": "staging", "branchPrefix": "node/" }
```

The same `spexcode.json` (read through `readConfig`) is also where adjacent project policy is DECLARED rather
than baked in — including the `harnesses` delivery-target set [[harness-select]] owns (which harnesses `spex
materialize` delivers into; default = every native harness). Layout resolution doesn't consume it, but it rides
the same committed-config-with-a-`spexcode.local.json`-overlay seam: persistent, re-read on every materialize.
The same seam carries [[host-resource-budget]]'s per-session RSS, per-backend RSS, idle-CPU, and sampling
budgets, and [[file-attach]]'s one `uploads` policy: attachment limit, chunk size, batch concurrency, request
timeout/retry, stale-transfer lifetime/reaper cadence, backend free-space reserve, and eval-evidence ceiling.
`readUploadPolicy()` takes the numeric defaults only from the shipped `templates/spexcode.json`, then overlays
the resolved project/local `uploads` object and validates every field loudly. Thus a pre-existing project may
omit the section and still receive the portable defaults, while one host can override only (for example) its
chunk size in gitignored `spexcode.local.json`; no upload-only configuration reader or environment-variable
shadow path exists. Machine-local overrides tune one host without committing its capacity profile, while
malformed values fail loud rather than silently disabling governance.

The config read is the ONE fail-loud seam here (`readJsonConfig`): an **absent** file is the legitimate
default (yields `{}`), but a **present-but-malformed** one is a user error we never swallow — a JSON typo
would otherwise silently drop every tuned setting the file holds (layout, launchers, and the lint budgets
[[spec-lint]]'s `loadConfig` reads through the same helper) and revert to defaults with no diagnostic. It
fails LOUD instead, naming the file and the parse error, so the author sees exactly what broke.

The **source-of-truth branch** — what worktrees fork from, merges land on, and reviews diff against — is a
stable project fact, never the mutable branch currently checked out in a particular directory. `spex init`
records the root checkout's branch in `mainBranch`; an explicit pre-existing value wins, and an older project
with no value uses the conventional `main`. This one-time adoption detection lets a `staging`/`feat-x` repo
work without hand configuration while an ordinary later `git switch node/x` cannot redefine that feature
branch as trunk. This single resolution is surfaced two ways downstream — `GET /api/settings`
for the dashboard and `spex internal trunk` (one line, for shell consumers like the [[main-guard]] pre-commit hook,
which asks "is HEAD the trunk?" instead of hardcoding `main`). Both resolve via the shared git **common**
dir, so they answer identically from the main checkout, a linked worktree, or a commit hook:
`mainCheckout()` exposes the root working tree itself
(`dirname` of the common dir), which a harness keying a per-PROJECT artifact to the root checkout uses — e.g.
Codex's hook shim + trust materialize at `mainCheckout(proj)`, not the worktree (see [[harness-adapter]]).
The common-dir and toplevel queries are memoized by their resolved input path for the process lifetime: the
no-argument common-dir query keys itself by the current working directory, so one process can deliberately
move between isolated repositories without inheriting another checkout's identity. Git's answer for a live
checkout is stable while that checkout exists, and one render must not fork the same identity probe once per
artifact. Different path inputs remain distinct, so a linked worktree still receives
its own tree slot while sharing only the common-dir-derived project root.
`mainRoot(proj?)` is the lighter sibling for consumers that need the configured source-of-truth path rather
than the physical root checkout: it follows the same common-dir resolution, reads only the root config, and
resolves its optional `main` relative to that checkout. It must not call `resolveLayout()` or enumerate
session/worktree rows; creation authority and any other identity guard can compare canonical main roots without
turning a small identity question into a board read.

A managed session's node id comes from its global **record** (`node`, the ref the session was bound to —
which the branch slug's `-<id4>` suffix can't give), falling back to the branch (strip `branchPrefix`) when
absent. Beyond resolution, the seam produces the board's raw
material: for each governed record it computes that worktree's pending spec-node changes vs main (`ops`,
consumed by [[sessions]]' `buildBoard`) — the board ENUMERATES the global store (filtered to `governed:true`),
NOT `git worktree list`, so an unmanaged scratch worktree (`agent-*`) never appears. A **shelved** record
([[archive]]) is the one governed row that still enumerates but computes NO `ops`: that git-history probe is
the seam's dominant per-row cost and shelving is the human declining to spend it, so its row is served bare
and its cached delta is evicted rather than kept alive by a row nobody is watching.
The graph supplies the exact ids from its already-frozen public session projection when it resolves this layout.
That projection is the archive authority for graph overlays too: a valid cold archived row stays bare, while an
invalid cold witness or resident-runtime hazard is projected back into the working set and retains its worktree
delta. The full graph producer and the session splice therefore cannot disagree about whether that root contributes
ops; callers that do not publish the graph's session state omit the projection and retain the raw-record default.

Layout rows are a public record projection, not an internal-readiness view. `resolveLayout()` consumes the same
layout-owned three-way parser as the session list and resource report: a valid launch-readiness-pending row
keeps the frozen original status/archive fields and explicit offline liveness; a malformed fence remains a
present `corrupt` row with unknown liveness and performs no worktree delta walk. Semantic lifecycle/proposal
enum violations are malformed too. Thus `/api/settings` cannot
publish an idle/online candidate or silently drop an unreadable session while another surface stays fail-closed.

One public generation of the layout owns one exact overlay flight. Concurrent consumers such as
`/api/settings` and `/api/graph` join when main tip, worktree paths, worktree HEADs, and `.spec` signatures are
identical; completion is evicted immediately, so this is coordination rather than a second cache. The flight,
not whichever consumer arrived first, owns the bounded Git context. Each caller owns only its wait: a cancelled
graph build leaves a concurrent settings read alive, while the generation aborts its Git children once no caller
remains. Thus caller order cannot leak or erase cancellation authority. The existing
per-worktree result cache remains the only retained state. A cold miss plans the whole governed, non-archived
set together and lets [[git-exec]] batch clean immutable pairs; dirty and untracked worktrees retain their exact
working-tree semantics. A missing worktree is still omitted, a transient per-worktree failure still serves only
that row degraded, and a batch failure is never published as an empty successful overlay. The optimization may
reduce children, never rows, ops, rename attribution, dirty state, or fail-loud behavior.

Because the record left the worktree, an agent's `spex session done/park/ask` finds its OWN session in the
ENVIRONMENT (`envSessionId()`), with a harness-aware precedence: a harness's per-thread env var
(`sessionEnvVar`) that ALIASES to a governed record (via `harness_session_id`, [[runtime]]) beats
`SPEXCODE_SESSION_ID`. Codex needs this — its ONE shared per-project app-server ([[harness-adapter]]) runs
the agent's shell under the FIRST session's baked `SPEXCODE_SESSION_ID`, while codex injects the acting
thread's `CODEX_THREAD_ID` per command, which aliases correctly. Claude is unchanged (its env var already
equals its record id); a raw, un-aliased harness id is the last resort, below `SPEXCODE_SESSION_ID`.

**Alias search answers a question only about ids the store does not already own**, and both layers —
`readAliasedRecordEntry` and the shell twin `hp_store_dir` — apply that rule identically. Absence splits in
two. An id that owns a STORE DIRECTORY is already one of ours: "this session exists and has written no record
yet" — the sentinel-only self-launched agent above — is a settled fact about *that* session, so resolution
stops there and reports absence. Only an id owning no store directory can be some record's
`harness_session_id`, and only then may the search over records run. Collapsing the two halves is wrong twice
over. It is a mis-resolution: an unrelated record whose harness id happens to equal a live session's name
would answer under that name, displacing the session the id actually denotes. And it is unbounded work:
because the turn-failure supervisor reconciles every record once a second ([[sessions-core]]), a single
record-less store directory re-read and re-parsed the WHOLE store on every tick — measured on a live
339-session store with 176 record-less directories at 60,003 synchronous reads per second, which saturates
the event loop and starves every request behind it, the board build included. The cost of the correct rule is
one directory check, so the search stays linear only where a search is the actual question.

The same *policy-not-hardcode* rule governs where the config loaders look. The spec tree's **root
node** — the single top-level directory under `.spec/` that holds a `spec.md` — is detected at read
time, never assumed by name: the dogfood repo's is `spexcode`, a `spex init` adopter's is `project`. So
[[source-of-truth]]'s `specs.ts` resolves the two plugin roots (`<root>/.plugins` and `<root>/plugin-system`,
scanned by `loadSurface` per [[surface]]) from that *detected* root, not a baked-in `spexcode`. Without
it an adopter's `loadSystemConfig` finds nothing — the `.plugins/core` contract never loads, launched agents
get no system prompt — so portability is only real when the config root travels with the rename.

The reproducibility contract is concrete: `.nvmrc` pins Node (22) and both package-locks are tracked, so
installs are deterministic. Machine-local artifacts never enter the tree: a host-specific launcher `cmd`
lives in the gitignored `spexcode.local.json`'s `sessions.launchers` entry (`readConfig` overlays it on
committed `spexcode.json`; no env override — [[launcher-select]]), so a host-specific launcher path has a
*durable* home surviving restarts,
never committed. (The old HOST-personal render vote that lived in this overlay is retired with the whole
axis — [[residence]]: materialized artifacts are never tracked, and a lingering `render`/`private` field is ignored
with a loud notice.) A launch generates NO per-session SpexCode files in the worktree: the
record and the launcher products (prompt, launch, launch.sh, recorded comms) live in the per-user global
store ([[runtime]]), keyed by session_id, outside the tree — so nothing per-session is left to ignore or
commit (the contract instead reaches the agent by materializing into the worktree's OWN tracked
`CLAUDE.md`/`AGENTS.md`, not by hiding it into the store — see [[harness-delivery]]). No absolute machine
path is baked anywhere in the checkout.
