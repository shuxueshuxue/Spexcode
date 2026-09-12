---
title: serve
hue: 170
desc: Everything that holds a SpexCode port — the supervisor behind `spex serve` that owns the port and reloads without a gap, the one listener boundary every face binds through, and the gateways in front of loopback backends.
code:
  - spec-cli/src/supervise.ts
related:
  - spec-cli/src/reaper.ts
  - spec-cli/src/reaper.test.ts
---
# serve

Everything that holds a port for SpexCode. A project's backend is a **supervisor** that owns the port and a
**child** that answers behind it; the faces a person reaches from elsewhere are **gateways** in front of
loopback backends — [[public-mode]]'s password-and-TLS gateway (and `spex serve ui`, the same gateway
ungated) and [[host-gateway]]'s one `spex dashboard` for every project on the host. [[listener-readiness]] is
the one bind boundary all of them go through. What they share is the contract below: the port is owned or the
process exits loudly, a reload never leaves the port with a gap, and an abandoned connection dies server-side.

The `serve` script (the `npm run api` entry) hot-reloads the backend on changes to **any source tree in the
compiled runtime closure** — its own `spec-cli/src/**` plus the sibling packages it loads at runtime
(`spec-forge`, `spec-core`, `transcript`, `session-application`) — never on `.spec/**/spec.md` or `spec-dashboard` edits, which it
reads via fs or never imports (the frontend is a separate vite server with its own HMR). In a source workspace
the supervisor rebuilds that closure before it reloads; an installed package watches only its shipped `dist`.
Watching only its own dir was a real gap: a merge touching `spec-forge` reached disk while the running child
kept the stale code, so a fix could ship to `main` yet stay invisible on the live dashboard. **The reload must
be zero-downtime: port 8787 never has a gap.** A process restart left a ~1-2s window where every API call was
refused (a node merge touching backend code took the dashboard down); that window must not exist.

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

**Last-resort resilience:** both supervisor and child install [[worktree-resilience]]'s process guards at startup — an unforeseen
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
