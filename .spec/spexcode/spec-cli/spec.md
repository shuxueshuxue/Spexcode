---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/listen.ts
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/cli.ts
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
the file this node governs (the deeper mechanism lives in its [[source-of-truth]] subtree; the yatsu
eval endpoints' contract belongs to [[spec-yatsu]], so their churn — the eval-blob comment reframed to
serve a transcript or image, not just pixels — is that subtree's evolution, not spec-cli's drift).

A CLI output contract, in the same fail-loud spirit: a verb with unbounded stdout (`issues --json`,
`board`, `review --json`, `yatsu show --json`, …) must FULLY reach a pipe. `process.exit()` force-quits
without draining buffered pipe writes, silently truncating a large dump at the ~64KB pipe buffer, so those
verbs exit through a shared **flush-then-exit** helper that waits for stdout to drain first — a >64KB piped
board or issue dump arrives whole, never a JSON cut off mid-object that reads as complete.

The `serve` script (the `npm run api` entry) hot-reloads the backend on changes to **any source tree the
child actually imports** — its own `spec-cli/src/**` plus the sibling packages it loads at runtime
(`spec-forge`, `spec-yatsu`) — never on `.spec/**/spec.md` or `spec-dashboard` edits, which it reads via fs
or never imports (the frontend is a separate vite server with its own HMR). Watching only its own dir was a
real gap: a merge touching `spec-forge` reached disk while the running child kept the stale code, so a fix
could ship to `main` yet stay invisible on the live dashboard. **The reload must be zero-downtime: port 8787
never has a gap.** A `tsx watch` restart left a
~1-2s window where every API call was refused (a node merge touching backend code took the dashboard
down); that window must not exist.

The mechanism is a tiny **supervisor** (`serve` runs `supervise.ts`) that owns the public port as a
raw-TCP proxy and runs the real Hono server as a child on a private port. On a source change it boots a
fresh child, waits for `GET /health` (a cheap, git-free readiness probe), atomically flips the proxy to
it, then **gracefully drains** the old child — which stops accepting new connections but finishes
in-flight requests before exiting. The public socket never closes, so the flip is invisible. (SO_REUSEPORT
is the obvious alternative but is unsupported on this platform, hence the proxy.) An unhealthy new child
is discarded and the current one kept, so a broken edit degrades to "still serving old code", never a gap.
Live ws/pty bridges drop and reconnect; detached tmux sessions survive untouched. (Under `spex serve
--public` the supervisor's raw proxy retreats to a **loopback** port and the password-gated [[public-mode]]
gateway takes the public port — loopback stays the trusted face local agents reach; the gateway is the
internet face. Default `serve` is unchanged: the proxy itself owns the public port.) The dashboard also
retries a transient failure with bounded backoff, so a poll landing on the flip is masked. Because the
child binds a **private** port that changes on every reload, the supervisor hands it a fixed
`SPEXCODE_API_URL` at the **public** port; every session the child launches inherits it, so a launched
agent's own `spex` calls reach the stable public endpoint instead of chasing a retired child's port.

**Owning the public port is the contract: if I cannot bind it, I have failed.** Keeping-serving is for
*transient* throws once the port is held — never for *failing to acquire* it. So a bind failure (port in
use, or permission denied) is the one throw the supervisor must not swallow: a **hard, loud, non-zero exit**
naming the busy port and the repair, never a portless process kept "alive" on a random child port. The same
rule is **shared** with [[public-mode]]'s gateway behind `spex dashboard`, so a busy port fails identically
on both surfaces — not a silent zombie under `serve` and a crash under `dashboard`. One shared bind helper
both call (not a branch inside the keep-alive guard) reaps the booted child first, so no zombie survives.

**Last-resort resilience:** both supervisor and child install process guards at startup — an unforeseen
async throw (a worktree vanishing mid-read during a worker self-merge, say) is logged and the process
KEEPS SERVING rather than exiting and dropping the public port (and the tmux session) with it.

Read routes: `/api/board` (the assembled board — merged tree + per-worktree overlay + session list, the
dashboard's single source, identical to `spex board`) and its push companion `/api/board/stream`
([[board-stream]]), an SSE that fires on session-store change so the dashboard reloads on real transitions
instead of a tight poll. `/api/board` stays a **conditional-request** endpoint: it `ETag`s the body so a
reload that finds nothing changed costs a bodyless `304`, not the whole transfer — a standard HTTP capability,
not a special case (the board is still rebuilt each request; the cost saved is the wire, not the git read). `/api/specs` (live via `loadSpecs`),
`/api/specs/:id/history` + `/api/specs/:id/diff/:hash` (a node's timeline and any version's spec.md
line-diff), `/api/specs/lite` + `/api/specs/:id/content` (filesystem-only body reads the lean board
([[board-lean]]) offloads: the whole search corpus, and one node's `{body, parts}` on open), `/api/edit`
(a node's in-flight working-tree delta vs its fork point, reviewable from the
board — incl. a **brand-new, still-untracked node** as an all-additions diff, so a just-created uncommitted
node shows its body not nothing), `/api/layout` (the resolved
[[portable-layout]]), and `/api/config` + `/api/slash-commands` (the
`/` dropdown — config-root plugins declaring `surface: command`, plus the Claude-Code command union).

Write/runtime routes are thin callers of the [[sessions]] state machine — no session logic lives here:
`/api/sessions` list + spawn; per-session `resume`/`review`/`close`, plus reads `review` (the merge
bundle), `capture` (the live pane as text), and `prompt`. `merge` is a **dispatch to the session's own
agent**, not a server merge — it returns `{dispatched}` and never touches main's tree. The ❯ box
(`keys`) dispatches a whole prompt over the rendezvous control socket, fail-loud (an unconfirmed prompt is
502, never a silent 200); `rawkey` keeps tmux send-keys for nav; `socket` streams pane bytes.
`/api/sessions/graph` edges are DERIVED from live `spex watch` monitors (`watch`/`unwatch` register +
heartbeat), not a stored subscription. `/api/uploads` writes a pasted file to this (worker) machine's
/tmp and returns its path. At boot the server also runs `superviseQueue()` to launch queued sessions.
