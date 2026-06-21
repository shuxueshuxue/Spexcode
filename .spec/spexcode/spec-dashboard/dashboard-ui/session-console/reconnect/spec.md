---
title: reconnect
status: active
hue: 280
desc: The live terminal's socket reopens itself after a genuine drop (a backend restart), loudly — so a pane never needs a manual refresh.
code:
  - spec-dashboard/src/resilientSocket.js
  - spec-dashboard/src/SessionTerm.jsx
---

# reconnect

A live terminal pane must never need a manual page refresh to come back. The [[live-view]] backend fix
removed the cause that used to freeze a pane — a per-session bridge dying under a still-open socket — so
bridge churn no longer closes the socket at all. What remains is the **one** case the backend cannot mask:
a backend **process** restart (the zero-downtime supervisor reload), which genuinely drops every socket.

So the client owns recovery from a real drop, **and only** from a real drop. The socket **reopens itself**:
on an unexpected close it retries with **capped, escalating backoff**, indefinitely, while surfacing a
visible **"reconnecting…"** state — recovery is **loud**, never a silently dead pane. A connection that
stays healthy a few seconds **resets** the backoff; a flapping server **escalates** to the cap instead of
hammering it. The single **intentional** close — the pane unmounting, when a session goes offline and the
header swaps in the relaunch panel — stops reopening for good.

Recovery is a **stateless reopen**, not a resync or sequence protocol. The endpoint is addressed by a stable
session id and the backend holds all state in tmux, so a reopen is answered exactly like a first connect: a
single coherent full repaint onto a freshly reset screen. There is nothing on the client to replay or
reconcile — which is why reconnection here is a thin **transport** concern, not a correctness mechanism, and
why it does not reintroduce the snapshot-splice scramble [[live-view]] warns against.

The reconnect lives in a small, **framework-agnostic** helper that the terminal wires its open / message /
state callbacks into; its WebSocket implementation and timers are **injectable**, so the reconnect state
machine — backoff schedule, stable-vs-flapping reset, intentional-close suppression, state transitions — is
verifiable headlessly, with no browser and no real network.
