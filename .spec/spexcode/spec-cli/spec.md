---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
---
# spec-cli

## raw source

One of three SpexCode packages (with spec-dashboard and spec-yatsu). It is the server + CLI: read the
`.spec` tree and its git history, serve them over an API, ship the `spex` CLI, and house the
**source-of-truth** guards (git-as-database, the worktree linker, the guards, the linter) here — under
the CLI where they belong, not under the dashboard. Hono + tsx, **no build step**.

## expanded spec

`spec-cli` is the backend. It owns the read path (turn `.spec` + git into JSON) and the write path
(the `spex` CLI driving worktrees/sessions); the dashboard is a thin HTTP caller. `index.ts` is the
HTTP entrypoint — a Hono app that wires the loaders and the session state machine to routes — and is
the file this node governs (the deeper mechanism lives in its [[source-of-truth]] subtree).

Routes it must expose:

- `GET /api/board` — the assembled board (merged tree + per-worktree overlay + session list), the
  dashboard's single source; identical data to `spex board`, the frontend only adds x/y pixels.
- `GET /api/specs` — every node, derived live (`loadSpecs`).
- `GET /api/specs/:id/history` — a node's version timeline.
- `GET /api/layout` — the resolved [[portable-layout]].
- `/api/sessions` — list + spawn, plus per-session lifecycle (`resume`/`review`/`merge`/`close`),
  an SSE pane `stream`, and `keys` for keystroke forwarding. These are thin callers of the
  [[sessions]] state machine; no session logic lives in `index.ts`.

## current state

### description

`index.ts` is the Hono app and process entry. It mounts CORS on `/api/*`, then registers
`GET /` (a route list), `GET /api/board`, `GET /api/specs`, `GET /api/specs/:id/history`,
`GET /api/layout`, and the full `/api/sessions` surface: `GET`/`POST` for list/spawn,
`POST :id/resume|review|merge`, `GET :id/stream` (SSE that polls `captureSession` ~600ms and stops on
client disconnect or `alive()` false), `POST :id/keys`, and `POST :id/close`. It listens on
`PORT` (default 8787). It is run with `tsx`, no build step; `npx tsc --noEmit` type-checks. The `spex`
CLI front door is `cli.ts` (see [[spec-lint]] for `spex lint`, [[sessions]] for `spex session`), which
imports `index.js` for `spex serve`. Not in this file: the loaders, git access, and session machine —
they live in `specs.ts`/`git.ts`/`layout.ts`/`board.ts`/`sessions.ts` under the source-of-truth subtree.

### verdict — not drifted

`index.ts` is the only governed file and sits at this node's latest version with no commits ahead
(`spex lint` reports no `drift` warning for `spec-cli`). The expanded spec states the route contract as
intended behavior; the description is the honest read of how `index.ts` meets it today. The session
routes grew when [[sessions]] landed, and the expanded spec now names them as thin callers — that is the
file's clarified contract, not a code change back-written to look complete; the raw source (a server
that serves `.spec`+git and houses the guards) still holds.
