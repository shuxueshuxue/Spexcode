---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/slash-commands.ts
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

The `serve` script (the `npm run api` entry) hot-reloads the backend on its own source changes
(`spec-cli/src/**`) — never on `.spec/**/spec.md` or dashboard edits, which it reads via fs rather than
importing. **The reload must be zero-downtime: port 8787 never has a gap.** A `tsx watch` restart left a
~1-2s window where every API call was refused (a node merge touching backend code took the dashboard
down); that window must not exist.

The mechanism is a tiny **supervisor** (`serve` runs `supervise.ts`) that owns the public
port as a raw-TCP proxy and runs the real Hono server as a child on a private port. On a source change it
boots a fresh child, waits for `GET /health` (a cheap, git-free readiness probe `index.ts` exposes), then
atomically flips the proxy to it and **gracefully drains** the old child — which stops accepting new
connections but finishes in-flight requests before exiting, so a request mid-flight is never reset. The
public socket never closes, so the flip is invisible. (SO_REUSEPORT — two processes sharing the port — is
the obvious alternative but is unsupported on this platform, hence the proxy.) An unhealthy new child is
discarded and the current one kept, so a broken edit degrades to "still serving old code", never to a
gap. The live ws/pty bridges still drop on reload and reconnect; detached tmux sessions survive untouched.

The dashboard rides through any residual blip itself: its `data.js` fetches retry a transient connection
failure with bounded backoff (~5 tries over ~2s) before surfacing an error, so a reload is invisible to
the UI even if a poll lands exactly on the sub-second flip.

Routes it must expose:

- `GET /api/board` — the assembled board (merged tree + per-worktree overlay + session list), the
  dashboard's single source; identical data to `spex board`, the frontend only adds x/y pixels.
- `GET /api/specs` — every node, derived live (`loadSpecs`).
- `GET /api/specs/:id/history` — a node's version timeline.
- `GET /api/layout` — the resolved [[portable-layout]].
- `/api/sessions` — list + spawn, plus per-session lifecycle (`resume`/`review`/`merge`/`close`),
  an SSE pane `stream`, and `keys` for keystroke forwarding. These are thin callers of the
  [[sessions]] state machine; no session logic lives in `index.ts`.
