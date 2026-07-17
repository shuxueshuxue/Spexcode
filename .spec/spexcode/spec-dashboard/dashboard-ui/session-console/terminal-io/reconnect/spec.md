---
title: reconnect
status: active
hue: 280
desc: The live terminal's socket reopens itself after a genuine drop (a backend restart), loudly — so a pane never needs a manual refresh.
code:
  - spec-dashboard/src/resilientSocket.js#createResilientSocket
related:
  - spec-dashboard/src/SessionTerm.jsx
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
prevent.

So a dead link must be **detectable from traffic alone**, which makes liveness a two-sided **heartbeat
contract**, same shape as the board stream's ([[dashboard-shell]]): the **server** sends a small keep-alive
ping over every terminal socket on a fixed cadence (10s — traffic that also keeps an idle link warm through
NAT timeouts), so the client is **guaranteed** inbound bytes on a healthy link; the **client** holds the
socket to that promise — *any* inbound message proves liveness, and an OPEN socket silent past **2.5× the
cadence** (25s: absorbs one dropped ping plus jitter, still fast enough to feel like recovery, not a reload)
is **presumed dead**, force-dropped, and handed to the same reopen machinery as a real close event. The
cadence is the contract's **one primitive number** — one constant per side of the wire, the client's a
mirror of the server's held equal by test (as the board stream's pair is), and every other window (the dead
window, the watchdog's check rate) **derived** from it, never a free-standing magic number. No separate
recovery path: detection is the only new act; a presumed-dead drop reopens, backs off, and announces itself
exactly like a genuine drop.

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
state callbacks into; its WebSocket implementation, timers, and clock are **injectable**, so the reconnect
state machine — backoff schedule, stable-vs-flapping reset, intentional-close suppression, the silence
watchdog's presumed-dead drop, state transitions — is verifiable headlessly, with no browser and no real
network.
