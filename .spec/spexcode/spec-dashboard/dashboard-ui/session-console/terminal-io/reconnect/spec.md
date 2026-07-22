---
title: reconnect
status: active
hue: 280
desc: The live terminal's socket reopens itself after a genuine drop (a backend restart), loudly — so a pane never needs a manual refresh.
code:
  - spec-dashboard/src/resilientSocket.js#createResilientSocket
related:
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/heartbeat.js
  - spec-dashboard/src/resilientSocket.test.mjs
  - spec-cli/src/index.ts
---

# reconnect

A live terminal pane must never need a manual page refresh to come back. The [[live-view]] backend fix
removed the cause that used to freeze a pane — a per-session bridge dying under a still-open socket — so
bridge churn no longer closes the socket at all. What remains are the **two** cases the backend cannot mask:
a backend **process** restart (the zero-downtime supervisor reload), which genuinely drops every socket —
and a link that dies **silently**. The second is the treacherous one: an idle terminal socket crossing a
NAT / tunnel / reverse-proxy (the public gateway path) can be torn down in the middle with **no close event
ever reaching the browser** — a half-open connection whose `readyState` still says OPEN. The pane then
looks alive but is deaf: frames stop arriving, a resize sent on it vanishes, and (before this contract)
nothing ever noticed — the frozen-terminal-until-manual-refresh bug, exactly what reconnection exists to
prevent. The same silence can strand a new socket in CONNECTING or a server-initiated close handshake in
CLOSING; a browser's eventual handshake timeout is not this module's liveness guarantee.

So a dead link must be **detectable from traffic alone**, which makes liveness a bidirectional **heartbeat
contract**, same shape as the board stream's ([[dashboard-shell]]). On one fixed cadence (10s), the server sends
both a WebSocket **protocol ping** and a small text ping. The browser network stack answers the protocol pong
without application JavaScript; the text ping reaches JavaScript and re-arms its inbound dead-man switch. Each
side therefore holds the other to the promise it can actually observe: the client gives every current socket it
did not intentionally close — CONNECTING, OPEN, and CLOSING — one **2.5× cadence** silence deadline, while the
server forcibly removes a viewer that produces no protocol pong inside that same window. Neither client
handshake borrows an eventual platform timeout. Server expiry owns cleanup directly rather than waiting for a
transport `close` event that a half-open link may never deliver, so [[live-view]] cannot retain a ghost tmux
client or size claim. The
cadence is the contract's **one primitive number**, and on the client it lives in ONE place: the shared
heartbeat module (`heartbeat.js`) that the board SSE stream reads too — a single constant for the whole
client, held equal to the server's ping cadences by test, the dead window **derived** from it, never a
free-standing magic number or a per-channel copy. Detection itself is likewise the shared module's
**dead-man's switch** — event-driven, not a polling loop: one one-shot timer armed when a socket is constructed
and re-armed when it opens and by every inbound message — so on a healthy link nothing ever wakes, and the
switch fires exactly once at the current phase's silence deadline. No separate
recovery path: detection is the only new act; a presumed-dead drop reopens, backs off, and announces itself
exactly like a genuine drop.

Heartbeat deployment is **rolling-compatible**. A backend reload may meet a page still running the previous
hashed frontend bundle, so server-side liveness can never require a newly-added JavaScript reply: doing that
turns every old open tab into a deterministic 25-second reconnect loop until the human refreshes. Protocol
pong is the stable browser capability across bundles. The current client still answers each text ping with a
text pong, and the server still accepts it, so the opposite rolling order (new frontend against the immediately
previous backend) remains live too. This overlap is transport-version compatibility, not a second product
heartbeat or a requirement for atomic frontend/backend deployment.

The socket **reopens itself**:
on an unexpected close it retries with **capped, escalating backoff**, indefinitely, while surfacing a
visible **"reconnecting…"** state — the pane tracks a small `connecting | open | reconnecting` health and
shows it in a corner caption, so recovery is **loud**, never a silently dead pane. A connection that
stays healthy a few seconds **resets** the backoff; a flapping server **escalates** to the cap instead of
hammering it. The single **intentional** close — the pane unmounting, when a session goes offline and the
header swaps in the relaunch panel — stops reopening for good.

Recovery is a **stateless reopen**, not a resync or sequence protocol. The endpoint is addressed by a stable
session id and the backend holds all state in tmux, so a reopen is answered exactly like a first connect: a
single coherent full repaint onto a freshly reset screen. There is nothing on the client to replay or
reconcile — which is why reconnection here is a thin **transport** concern, not a correctness mechanism, and
why it does not reintroduce the snapshot-splice scramble [[live-view]] warns against.

The reconnect lives in a small, **framework-agnostic** helper that the terminal wires its open / message /
state callbacks into; its WebSocket implementation and timers are **injectable**, so the reconnect
state machine — backoff schedule, stable-vs-flapping reset, intentional-close suppression, the dead-man
switch's presumed-dead drop in every socket phase, state transitions — is verifiable headlessly, with no
browser and no real network.
