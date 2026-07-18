---
title: spec-cli
status: merged
session: sess-design
hue: 200
desc: The server + CLI — reads .spec and git, serves the API, and houses the source-of-truth guards.
code:
  - spec-cli/src/index.ts
related:
  - spec-cli/src/reaper.ts
  - spec-cli/src/reaper.test.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/listen.ts
  - spec-cli/src/slash-commands.ts
---
# spec-cli

## raw source

One of three SpexCode packages (with spec-dashboard and spec-eval). It is the server + CLI: read the
`.spec` tree and its git history, serve them over an API, ship the `spex` CLI, and house the
**source-of-truth** guards (git-as-database, the worktree linker, the guards, the linter) here — under
the CLI where they belong, not under the dashboard. Hono + tsx, **no build step**.

## expanded spec

`spec-cli` is the backend. It owns the read path (turn `.spec` + git into JSON) and the write path
(the `spex` CLI driving worktrees/sessions); the dashboard is a thin HTTP caller. `index.ts` is the
HTTP entrypoint — a Hono app that wires the loaders and the session state machine to routes — and is
the file this node governs (the deeper mechanism lives in its [[source-of-truth]] subtree; the
eval endpoints' contract belongs to [[spec-eval]], so their churn — the eval-blob comment reframed to
serve a transcript or image, not just pixels — is that subtree's evolution, not spec-cli's drift).

A CLI output contract, in the same fail-loud spirit: a verb with unbounded stdout (`issues --json`,
`board`, `review --json`, `eval ls --json`, …) must FULLY reach a pipe. `process.exit()` force-quits
without draining buffered pipe writes, silently truncating a large dump at the ~64KB pipe buffer, so those
verbs exit through a shared **flush-then-exit** helper that waits for stdout to drain first — a >64KB piped
board or issue dump arrives whole, never a JSON cut off mid-object that reads as complete.

The `serve` script (the `npm run api` entry) hot-reloads the backend on changes to **any source tree the
child actually imports** — its own `spec-cli/src/**` plus the sibling packages it loads at runtime
(`spec-forge`, `spec-eval`) — never on `.spec/**/spec.md` or `spec-dashboard` edits, which it reads via fs
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
That injected URL is **deterministic — always the supervisor's own loopback face, never the ambient
`SPEXCODE_API_URL` this serve itself inherited** (which may carry another project's backend): a worker's
env is its routing lifeline ([[remote-client]]'s ladder), a backend-owned fact rather than an inheritance
gamble. And once the public bind succeeds, the supervisor **publishes its endpoint** — atomically, in
the per-project runtime tier, as an instance-validated record (`{url, pid, instanceId, root}`; the
`instanceId` is minted per serve lifetime, handed to every child via env, and answered live at
`GET /api/instance`) — the record a bare human `spex` in this project's tree discovers its backend by,
and the record the host-level `spex dashboard` ([[host-gateway]]) reconciles its project list from. On a
clean stop it removes only a record still carrying its own `instanceId`. Readers validate before
trusting (a health/identity probe), so a crashed serve leaves only a dead record that is ignored, never
followed.

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

**Connection reaping — abandoned sockets die server-side.** A backend that never reaps abandoned connections
wedges even while its event loop is idle: a client that times out and kills its request leaks one server-side
socket each time, and enough of them (135 were observed piling on the public port) starve the backend into
*looking* dead while it is actually healthy — the trigger of the mass-restore cascade. Two layers close this,
matched to what each server is. The **child** (and, in public mode, the **gateway**) is a real HTTP server,
and its reaper is the **single owner** of the abandoned-socket deadlines: Node's own overlapping HTTP
timeouts (`headersTimeout`, `keepAliveTimeout`) are DISABLED at reaper install — they cover the same phases
and so are a second mechanism racing the first, and MEASURED (eval `server-reaps-abandoned-connections`,
issue #65) a `headersTimeout: 20000` set beside the reaper won the race at default config on every reap and
silently capped `SPEXCODE_REAP_HEADER_MS` above 20s: the close still looked timely (Node's 408), but the
tunable had silently stopped tuning. No timeout `serverOptions` are passed at the `serve`/`createServer`
sites; `requestTimeout` alone stays at Node's default (~5 min) because it bounds the in-flight request-body
phase the reaper deliberately exempts (a silently-abandoned mid-body upload has no other reaper) and 5 min
shadows no sane deadline. The reaper is an explicit **socket-level deadline** at the
server boundary (`reaper.ts`, one helper installed at every HTTP `createServer`/`serve` site): on socket
birth it is armed with a header deadline it must complete a request within, else it is destroyed; while a
request is in flight the deadline is disarmed (so a slow board build or a streaming response is never cut);
when the response ends the socket re-arms an idle keep-alive deadline. It keys on "no request completed yet /
idle between requests", **never on response duration**, so an *active* WS/SSE stream (the board-stream, the
terminal socket) is exempt for as long as it streams — a WebSocket upgrade is marked exempt for its whole
lifetime. **Which socket carries the deadline is part of the contract**: the deadline must live on the socket
`'request'`/`'upgrade'` actually report, because a deadline the request path cannot reach never disarms and
becomes a kill-timer for *every* connection. On a TLS server (the public gateway) that socket is the
TLSSocket born at `'secureConnection'` — NOT the raw TCP socket `'connection'` delivers; arming the raw
socket there once severed every healthy gateway connection (the actively-pinging board SSE, live terminal
WebSockets) at exactly the header deadline, the dashboard's ~30s "reconnecting…" storm (MEASURED, eval
`stream-survives-public-gateway` on [[graph-stream]]). The raw pre-handshake phase keeps its own header
deadline (a TCP connect that never finishes the TLS handshake is the same slow-loris one layer down), handed
off to the TLSSocket at handshake completion via the connection's addr:port pair — public API only, and a
criterion, not an allowlist: no route- or protocol-specific exemptions, just "deadlines are reachable from
request handling, streams in flight are never duration-reaped". Deadlines are env-tunable
(`SPEXCODE_REAP_HEADER_MS` ≈30s, `SPEXCODE_REAP_IDLE_MS` ≈15s). The
**supervisor** is a raw-TCP proxy, so its equivalent is pairing: a close on *either* half tears down *both* —
the old handler bailed only on `error`, so a clean FIN or a silent client drop left the upstream half-open
forever (the leak). A truly silent abandon that never sends FIN/RST is reaped from the child by its
socket-level deadline, whose close then propagates back through the proxy — so no raw idle timeout is put on
the proxy itself, which would blind it to a legitimately-idle WS/SSE.

Read routes: `/api/graph` (the assembled board — merged tree + per-worktree overlay + session list, the
dashboard's single source, identical to `spex graph --json`) and its push companion `/api/graph/stream`
([[graph-stream]]), an SSE that fires on session-store change so the dashboard reloads on real transitions
instead of a tight poll. `/api/graph` stays a **conditional-request** endpoint: it `ETag`s the body so a
reload that finds nothing changed costs a bodyless `304`, not the whole transfer — a standard HTTP capability,
not a special case (the board is still rebuilt each request; the cost saved is the wire, not the git read). `/api/specs` (live via `loadSpecs`),
`/api/specs/:id/history` + `/api/specs/:id/diff/:hash` (a node's timeline and any version's spec.md
line-diff), `/api/specs/lite` + `/api/specs/:id/content` (filesystem-only body reads the lean board
([[graph-lean]]) offloads: the whole search corpus, and one node's `{body, parts}` on open), `/api/edit`
(a node's in-flight working-tree delta vs its fork point, reviewable from the
board — incl. a **brand-new, still-untracked node** as an all-additions diff, so a just-created uncommitted
node shows its body not nothing), `/api/settings` (the resolved
[[portable-layout]]), and `/api/plugins` + `/api/slash-commands` (the
`/` dropdown — config-root plugins declaring `surface: command`, plus the Claude-Code command union).

Write/runtime routes are thin callers of the [[sessions]] state machine — no session logic lives here:
`/api/sessions` list + spawn; per-session `resume`/`review`/`close`, plus reads `review` (the merge
bundle), `capture` (the live pane as text), and `prompt`. `merge` is a **dispatch to the session's own
agent**, not a server merge — it returns `{dispatched}` and never touches main's tree. The ❯ box
(`keys`) dispatches a whole prompt over the rendezvous control socket, fail-loud (an unconfirmed prompt is
502, never a silent 200); `rawkey` keeps tmux send-keys for nav; `socket` streams pane bytes.
`/api/sessions/edges` edges are DERIVED from live `spex watch` monitors (`watch`/`unwatch` register +
heartbeat), not a stored subscription. `/api/uploads` writes a pasted file to this (worker) machine's
/tmp and returns its path. At boot the server also runs `superviseQueue()` to launch queued sessions.

Issue routes follow the same thin-port rule: `GET /api/issues` returns the merged issue list plus the
writable stores (`local` and configured forge drivers), `GET /api/issues/:id` is the single-thread detail
(the same `findIssue` read behind `spex issue show`; unknown or eval-remark ids 404), and `POST /api/issues`
opens a new issue in the
chosen store. Local writes hit the git-native local store; forge writes call the driver and force a resident
read-back before the dashboard reloads. Evidence bytes ride `/api/evidence` (`POST` = content-addressed put,
`GET /:hash` = ranged streaming read — renamed from `/api/yatsu/blob` in v0.3.0).
