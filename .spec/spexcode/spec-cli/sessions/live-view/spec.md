---
title: live-view
status: active
hue: 280
desc: The dashboard's live terminal — one tmux control-mode client per session, event-driven (timer-free deterministic resize, pushed UTF-8 bytes, zero polling), with viewer subscriptions that outlive the client so a pane never freezes.
code:
  - spec-cli/src/pty-bridge.ts
  - spec-cli/src/pty-bridge.stress.ts
related:
  - spec-dashboard/src/SessionTerm.jsx
---

# live-view

The dashboard's **live terminal** is a browser view of a session's tmux pane over one WebSocket per session:
server→client is raw pane bytes; the human never *types* into the view (prompts travel out-of-band — see
[[dispatch]]). The one thing that does travel client→server besides a resize is the **wheel** — navigation,
not input — so a full-screen TUI can scroll its own history (see scrolling below). A genuine tmux client, not
an output tap.

## the bridge

Behind each session is exactly **one** real tmux client, shared by every viewer, so there is one
authoritative pane size and never a size-fight. That client is a **control-mode connection**
(`tmux -CC attach-session`): it speaks tmux's line protocol, so the pty↔tmux boundary is an **event stream,
not a poll loop** — bytes are *pushed* as `%output` events and a resize is announced by a `%layout-change`.

**The whole control stream is parsed as bytes — never a string round-trip.** node-pty hands the bridge **raw
Buffers**; it splits lines on the newline **byte**, un-escapes `%output` at the byte level, and broadcasts the
pane's **raw UTF-8 bytes** verbatim (the `capture-pane` seed is joined and framed at the byte level too). This
is the whole fix for intermittent `�` corruption: node-pty's own UTF-8 decode chops the stream on OS-read
boundaries, so a wide character (CJK, box-drawing, emoji) straddling two reads becomes a U+FFFD **before the
bridge ever sees it**, unrecoverable. Byte-splitting is safe because tmux escapes only the C0 controls and
backslash as octal `\NNN` (all `< 0x80`) and passes high bytes through **raw**, and a newline never falls
inside a multi-byte character — so each wide char stays whole in one line, and un-escaping (each `\NNN` → its
one byte, all else untouched) yields the pane's exact UTF-8 with no decode/encode cycle to shatter it.

**Resize is deterministic and timer-free.** `refresh-client -C WxH` is guaranteed to emit exactly one
`%layout-change` carrying the converged `WxH` — even a same-size no-op emits one — so the bridge sets the size,
then **waits to be told** it re-wrapped by that event, which is a mathematical certainty of arrival, not a
hope. No settle-timeout, no geometry poll, no per-repaint pull; a repaint whose size already equals the known
layout paints at once. That guaranteed event is the whole convergence proof.

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

## coherence — a control-mode attach replays nothing, so a FULL frame reconstructs state

Control mode never replays a screen on its own — a bare attach and a plain refresh both emit nothing, and
(unlike a raw attach, where tmux resends the pane's whole terminal state) it never re-emits the alt-screen
switch or the app's mouse-tracking modes. So every (re)attach **seeds** its one coherent frame from a **bounded
pane capture at the converged size**, then lets the live output be the tail. The two stay coherent because tmux
serializes commands and notifications on one stream: the capture reflects the pane at its command boundary, so
any live output that follows lands *after* it and is never overwritten — the deterministic seed, not the banned
splice of a guessed-size snapshot into an already-flowing stream.

A **full** frame — every fresh (re)attach / re-bind, and the resize a viewer sends right after it resets its
xterm — leads the seed with a **DEC-mode prelude reconstructed from the pane's live flags** (`alternate_on`,
the mouse-tracking flags): so the browser xterm faithfully mirrors the pane — on the **alternate screen** for a
full-screen TUI (else its redraws pollute the normal scrollback and mis-render) and in the app's **mouse-tracking
mode** (so the wheel routes correctly, below). A plain resize re-seeds only the visible screen, under a
viewport-only clear (`\x1b[H\x1b[2J`, never `\x1b[3J`), so it never re-floods or wipes the seeded history.

## scrolling — the pane's real history, by whichever path the pane owns

The wheel reaches **genuine pre-attach history**, and *which* history depends on the pane, decided by the mode
the prelude put xterm in:

- **Normal-screen pane** (a shell, a log): its history lives in tmux's scrollback, which the full frame's
  bounded capture (`capture-pane -S`) seeds into **xterm's own scrollback**. The wheel scrolls xterm natively —
  reaching output from before the client attached.
- **Full-screen TUI** (alternate screen, owns the mouse — e.g. Claude Code): it keeps **no** scrollback in
  xterm to scroll, and scrolls *itself* on mouse input. So the wheel is **forwarded** — the browser, seeing its
  xterm in mouse-tracking mode, sends a `{wheel}` frame and the bridge injects the matching SGR mouse report
  into the pane (`send-keys`), so the **app scrolls its own real history**. This is the control-mode analogue
  of the raw-attach wheel forwarding; a read-only-scrollback view would leave such a pane unable to scroll at all.

The socket still carries no keyboard input — the wheel is the one navigation exception, and only for a
mouse-owning pane, so a normal shell never gets mouse bytes littered into its prompt.
