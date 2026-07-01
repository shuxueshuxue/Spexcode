---
title: live-view
status: active
hue: 280
desc: The dashboard's live terminal — one tmux control-mode client per session, event-driven (deterministic resize, pushed bytes, zero polling), with viewer subscriptions that outlive the client so a pane never freezes.
code:
  - spec-cli/src/pty-bridge.ts
related:
  - spec-dashboard/src/SessionTerm.jsx
---

# live-view

The dashboard's **live terminal** is a **read-only** browser view of a session's tmux pane over one
WebSocket per session: server→client is raw pane bytes, the human never types *into* the view (prompts
travel out-of-band — see [[dispatch]]) — a genuine tmux client, not an output tap.

## the bridge

Behind each session is exactly **one** real tmux client, shared by every viewer, so there is one
authoritative pane size and never a size-fight. That client is a **control-mode connection**
(`tmux -CC attach-session`): it speaks tmux's line protocol, so the pty↔tmux boundary is an **event stream,
not a poll loop** — bytes are *pushed* as output events (the bridge un-escapes and broadcasts them), and a
resize is *deterministic*: set the client size and tmux **tells** the bridge the pane re-wrapped, with the
converged size, in a few ms — never a resize-then-poll-geometry guess, never a per-repaint pull.

A supervisor keeps a **warm** client for every *detached* live session — so a tab paints fast — and
**skips** any session a human is already attached to in their own terminal. It holds the warm client at
the **last-known viewer size** (per session, then a global/fixed fallback), resizing a stale one off-screen
toward it, so a warm pane is already roughly right before anyone looks — the guess the handshake makes exact.

## first-visible, not first-connect

Panes are **warm and always connected**: a viewer's socket opens when the board loads, while its pane is
still **hidden at 0×0**. So the first frame must be drawn at the size the pane will have **when the human
looks at it**, not at connect time. Two connect shapes:

- **Visible (re)connect** — the client measures its pane and carries its real size **on the connect URL**;
  the server sizes the bridge to it and draws that first frame correct. A reconnect re-resolves the size, so
  it too hands over the live one. This is the only path the connect-query serves.
- **Hidden connect** — 0×0, no size rides along. The server does **not** paint a guessed prewarm frame:
  undersized, and landing in a hidden buffer it would only be overpainted the instant the pane became
  visible — the old two-stage scramble. It **defers** the one first-frame paint to the client's **first
  resize**, which fires the moment the pane becomes visible at its true size. A **bounded fallback** covers a
  viewer that never resizes: absent any resize, paint once at the prewarm size after a short delay, never blank.

The client mirrors this: the instant a hidden pane becomes visible it **fits and sends its real size at
once** — since that resize *is* what triggers the deferred first frame — and **wipes any guessed fallback
frame** so the paint lands clean. The fit-retry stays the **corrective** path for a size measured slightly
wrong mid-animation.

The client is forced to **UTF-8** (`tmux -u` plus a UTF-8 `LANG`), independent of the host locale — else a
backend with an empty/non-UTF-8 environment (e.g. a macOS LaunchAgent) makes tmux substitute `_` for every
wide character, though the pane stores it correctly.

## the durable-subscription invariant

A viewer subscribes to a **stable session id**, never the bridge instance, so the subscription **outlives
any number of bridge deaths and respawns**: when the tmux client exits the bridge is replaced underneath and
surviving viewers are transparently re-bound and repainted **on the same open socket** — invisible to the
browser, so a live pane can never freeze and **client reconnection is unnecessary for bridge churn**. Re-bind
is owned by the supervisor's reconcile pass: **alive-gated** (a dead session is reaped rather than respawning
into a storm) and **rate-limited** (a flaky session can't fork-bomb tmux). The repaint on every (re)attach is
**fail-loud** — it must fire, since an idle re-bound pane has nothing else to re-arm it. The **only**
intentional socket close is the human closing the pane (the board flipping a session to `offline`); a backend
*process* restart is the lone genuine socket drop, recovered by a stateless reopen of the same endpoint ([[reconnect]]).

## coherence

Control mode never replays a screen on its own — a bare attach and a plain refresh both emit nothing — so
every (re)attach **seeds** its one coherent frame from a **bounded pane capture at the converged size**, then
lets the live output stream be the tail. The two stay coherent because tmux serializes commands and
notifications on one stream: the capture reflects the pane at capture time, broadcast at its command
boundary, so any live output that follows lands *after* it and is never overwritten. This is **not** the
banned move — splicing a guessed-size snapshot into an already-flowing mid-flight stream; a capture at the
converged attach boundary is the deterministic seed, not a splice.

## read-only, xterm-owned scrollback

The view takes no keyboard input (a control-mode client accepts *commands*, not raw terminal bytes), so the
socket carries only a resize frame client→server. Scrollback is **xterm's own**: the live output stream
fills the browser terminal's buffer, so its native wheel-scroll *is* the history — no mouse-wheel forwarding
into tmux (a raw-attach artifact this replaces).
