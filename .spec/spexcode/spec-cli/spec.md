---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
related:
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/guidance-catalog.ts
  - spec-cli/src/edit-diff.api.test.ts
  - spec-cli/src/spec-version.api.test.ts
---
# spec-cli

The backend package is `@spexcode/spec-cli`; its declared dependencies are `@spexcode/spec-core`,
`@spexcode/session-application`, `@spexcode/session-selflaunch`, `@spexcode/transcript`, and
`@spexcode/spec-forge`. It is the composition boundary for the session, issue, source-policy, transport,
and content-addressed evidence implementations.

## raw source

One of the SpexCode packages (with spec-core, the session package stack, spec-forge, and spec-dashboard). It is the server + CLI: read the
`.spec` tree and its git history, serve them over an API, ship the `spex` CLI, and house the
**source-of-truth** guards (git-as-database, the worktree linker, the guards, the linter) here — under
the CLI where they belong, not under the dashboard. It publishes compiled JavaScript; TypeScript remains
development source rather than a consumer runtime requirement.

## Dependency arrival and subtraction

A new package edge is not free. Every arrival must either name the predecessor it replaces and remove that
predecessor in the same change, or carry a measured **No package predecessor** exception with an owner node and an
executable boundary check. Extracting a workspace package counts as an arrival for the published composition even
when its manifest adds no third-party dependency; a version-only bump or a script-only edit does not. Which commit
an edge arrived in is git's answer rather than this body's — `git log -S'<package>' -- '**/package.json'` reads it
back, and the recent/history tabs show it in place.

The CLI's live no-predecessor exception: `@spexcode/archify` is the vendored diagram renderer, owner [[archify]],
held to the CLI's exact rendered bytes by `packages/archify/test/library.test.mjs`. The daemon's server runtime
(Hono, its node server and WebSocket, `node-pty`) is not a CLI edge at all: it ships with the dashboard package and
the server loads it through that package ([[packaging]]). The dashboard's own exceptions, the daemon runtime's
among them, and their boundary checks belong to [[spec-dashboard]].

## expanded spec

`spec-cli` is the backend. It owns the read path (turn `.spec` + git into JSON) and the write path
(the `spex` CLI driving worktrees/sessions); the dashboard is a thin HTTP caller. `index.ts` is the
HTTP entrypoint — a Hono app that wires the loaders and the session state machine to routes — and is
the file this node governs (the deeper mechanism lives in its [[source-of-truth]] subtree). The HTTP seam also
serves content-addressed evidence bytes and accepts uploads through one `/api/evidence` route ([[evidence-store]]);
the dashboard and issue threads use that same transport.

A CLI output contract, in the same fail-loud spirit: a verb with unbounded stdout (`issue ls --json`,
`graph --json`, `session review --json`, `spec search --json`, …) must FULLY reach a pipe. `process.exit()` force-quits
without draining buffered pipe writes, silently truncating a large dump at the ~64KB pipe buffer, so those
verbs exit through a shared **flush-then-exit** helper that waits for stdout to drain first — a >64KB piped
board or issue dump arrives whole, never a JSON cut off mid-object that reads as complete.

The process that serves all of this is [[serve]]'s: the supervisor behind `spex serve` that owns the public
port, reloads the backend without a gap, publishes its endpoint and reaps abandoned connections, and the
gateways layered over it.

Read routes: `/api/graph` (the assembled board — merged tree + per-worktree overlay + session list, the
dashboard's single source, identical to `spex graph --json`) and its push companion `/api/graph/stream`
([[graph-stream]]), an SSE that fires on session-store change so the dashboard reloads on real transitions
instead of a tight poll. `/api/graph` stays a **conditional-request** endpoint: it `ETag`s the body so a
reload that finds nothing changed costs a bodyless `304`, not the whole transfer — a standard HTTP capability,
not a special case (the cost saved is the wire; how often the board is built is [[graph-cache]]'s). `/api/specs` (live via `loadSpecs`),
`/api/specs/:id/history` + `/api/specs/:id/diff/:hash` + `/api/specs/:id/version/:hash` (a node's timeline,
the spec.md line-diff one of its versions introduced, and spec.md as that version left it — the two
per-version reads answer only a hash from the node's own log and 404 anything else, [[source-of-truth]]),
`/api/specs/lite` + `/api/specs/:id/content` (filesystem-only body reads the lean board
([[graph-lean]]) offloads: the whole search corpus, and one node's `{body, parts}` on open), `/api/edit`
(a node's in-flight working-tree delta vs its fork point as git's porcelain word diff, reviewable from the
board, including a **brand-new, still-untracked node** as an all-additions diff so a just-created
uncommitted node shows its body instead of nothing), `/api/source` (one **byte window** of a governed source file, gated by the
same policy predicate the coverage walk uses — [[source-read]] owns the contract; the route only resolves the
root, compiles the policy, and maps a refusal onto its status), `/api/settings` (the resolved
[[portable-layout]]), and `/api/plugins` + `/api/slash-commands` (the
`/` dropdown — config-root plugins declaring `surface: command`, plus the Claude-Code command union).
The read-only guidance catalog ([[guidance-catalog]]) is exposed at `/api/guidance` and by the deterministic
`spex guidance` CLI entry point; it carries source references and hashes, never a second copy of plugin/help/guide
prose.

Write/runtime routes are thin callers of the [[sessions]] state machine — no session logic lives here:
`/api/sessions` list + spawn; `/api/sessions/archive-index` is the archived-only lean index (`id`, `title`, `label`,
`closedAt`, `node`) and never substitutes for the id-addressed detail. The one-time JSON importer is the only
legacy-tree entry; once it completes, ordinary list rows and every mutation read lifecycle status and parent topology
from the canonical session application database and fail loudly for a governed record with no row. Fenced or
ambiguous cutover states are rejected rather than selecting a compatibility path. Per-session `resume`/`interrupt`/`review`/`close`/`quarantine`, plus reads `review` (the merge
bundle), `capture` (the live pane as text), `prompt`, and id-addressed `closure` (the durable terminal-close
audit answer after record removal). `closure` returns only its target id and close time or 404; it is not a
second historical session collection. Every closure response carries its capability marker, including a 404,
so a client can distinguish no close fact from a backend that lacks the route. `merge` is a **dispatch to the session's own
agent**, not a server merge — it returns `{dispatched}` and never touches main's tree. Text input appends a
whole admissible prompt to the target timeline, then best-effort pokes its adapter; a proven-unreachable native
transport paired with a still-live registered worker refuses before that append as stranded, and is also 502.
`rawkey` keeps tmux send-keys for nav; `socket` streams pane bytes. Session
mutations that commit no transition also answer with a non-2xx JSON error, so a refused stop or close cannot
paint as a successful request on the dashboard; the lifecycle guard remains the authority on whether the
destructive action is allowed.
`/api/uploads` writes a pasted file to this (worker) machine's
/tmp and returns its path. At boot the server runs `superviseQueue()` to launch queued sessions,
`superviseTurnFailures()` to reconcile adapter-owned native failure subscriptions, `reconcileLaunchedRuntimes()` to
bring launched sessions' runtime bindings in line with whether they are running ([[sessions-core]]), and then
`superviseDelivery()`, the retry sweep those bindings scope to running sessions; the route layer still contains no
harness protocol branch.
The host ledger is equally thin: `GET /api/resources` returns [[host-resource-budget]]'s latest inventory.
It is read-only; existing lifecycle mutations consult the adapter-owned shared-runtime guard before cleanup.

Issue routes follow the same thin-port rule: `GET /api/issues` returns the merged issue list plus the
writable stores (`local` and configured forge drivers), `GET /api/issues/:id` is the single-thread detail
(the same `findIssue` read behind `spex issue show`; unknown ids 404), and `POST /api/issues`
opens a new issue in the
chosen store. Local writes hit the git-native local store; forge writes call the driver and force a resident
read-back before the dashboard reloads. Evidence bytes ride `/api/evidence` (`POST` = content-addressed put,
`GET /:hash` = ranged streaming read — renamed from `/api/yatsu/blob` in v0.3.0).
