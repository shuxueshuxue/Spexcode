---
title: live-view
status: active
hue: 280
desc: The dashboard's live terminal — one tmux control-mode client per session, event-driven (timer-free deterministic resize AND first paint, pushed UTF-8 bytes, zero polling), with viewer subscriptions that outlive the client so a pane never freezes.
code:
  - spec-cli/src/pty-bridge.ts
  - spec-dashboard/src/SessionTerm.jsx
  - spec-cli/test/pty-bridge.stress.ts
  - spec-cli/test/pty-bridge.osc8.ts
  - spec-cli/test/pty-bridge.scroll-redraw.ts
  - spec-cli/test/pty-bridge.reseed-reconnect.ts
  - spec-cli/test/pty-bridge.history.ts
  - spec-cli/test/vt-emulate.ts
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

Byte-verbatim covers **escapes that end a captured row**: the control-mode DCS wrapper (`\x1b\\` on exit) is
stripped from **protocol** lines only — a `capture-pane` reply **body** is pushed **raw**. A pane row can end
in `\x1b\\` as the ST closing an **OSC 8 hyperlink** (which Claude Code emits for URLs and xterm renders
underlined); eating it leaves the link unterminated, so xterm never closes it and underlines the **rest of the
screen** — the "whole terminal goes underlined when I scroll" glitch. The wrapper never rides inside a reply
block, so the strip stays on the protocol path and the body keeps its terminators.

**Resize is deterministic and timer-free.** `refresh-client -C WxH` is guaranteed to emit exactly one
`%layout-change` — even a same-size no-op emits one — so the bridge sets the size, then **waits to be told**
it re-wrapped by that event, which is a mathematical certainty of arrival, not a hope. Crucially the wait
accepts **whatever size the event announces**, never an exact match on the size that was asked: every
viewer, peek, and warm client is its own control client sharing ONE window under `window-size latest`, so
the converged size is routinely another client's — an exact-size wait deadlocks the attach seed forever
(the full-frame flag latches, mode flips get dropped, `%output` stays frozen: a mute black terminal). For
the same reason a mode flip **always** repaints (the repaint token dedups), and an *unsolicited* geometry
change — another client resized the shared window with no repaint in flight — re-seeds the viewers rather
than letting live deltas paint onto stale geometry. No settle-timeout, no geometry poll, no per-repaint
pull; a repaint whose size already equals the known layout paints at once.

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
  visible — the old two-stage scramble. It **defers** the one first-frame paint — **purely** — to the client's
  **first resize**, which fires the moment the pane becomes visible at its true size. There is **no timer
  fallback**: a pane that never resizes is a pane no one ever looks at (the client sends its real size the
  instant the pane becomes visible), so it needs no frame. This is **fail-loud** — no size, no paint until the
  resize arrives — and it makes the whole first-paint path **event-driven and zero-timer**, matching the
  timer-free convergence above: the bridge holds not one time-based heuristic on either path.

The client mirrors this: the instant a hidden pane becomes visible it **fits and sends its real size at
once** — since that resize *is* what triggers the deferred first frame. The fit-retry stays the **corrective**
path for a size measured slightly wrong mid-animation.

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
switch or the app's mouse-tracking modes. So every (re)attach **seeds** its one coherent frame from the
**current tmux view at the converged size**, then lets the live output be the tail. The two stay coherent because tmux
serializes commands and notifications on one stream: the capture reflects the pane at its command boundary, so
any live output that follows lands *after* it and is never overwritten — the deterministic seed, not the banned
splice of a guessed-size snapshot into an already-flowing stream.

A **full** frame — every fresh (re)attach / re-bind, and the resize a viewer sends right after it resets its
xterm — leads the seed with a **DEC-mode prelude reconstructed from the pane's live flags** (`alternate_on`,
the mouse-tracking flags): so the browser xterm faithfully mirrors the pane — on the **alternate screen** for a
full-screen TUI (else its redraws pollute the normal scrollback and mis-render) and in the app's **mouse-tracking
mode**. That same pane-mode reading is the source for wheel routing below; attach reconstruction and navigation
are not two independent interpretations of tmux state. A plain resize re-seeds only the visible screen, under a
viewport-only clear (`\x1b[H\x1b[2J`, never `\x1b[3J`), so it never re-floods history into a browser-owned
scrollback. **Every** frame leads with an SGR reset **and an OSC 8 hyperlink close** (`\x1b[m\x1b]8;;\x1b\\`)
before that clear, so no attribute or open-hyperlink state can leak across the clear from the prior frame:
`capture-pane -e` re-emits each cell's attributes and each row's hyperlink opens, so the frame is self-contained
— but a link whose close sat just below the previous capture window would otherwise stay open and underline the
new screen. And every frame **ends by placing the cursor where the pane really has it** (`\x1b[y;xH` from the
pane's `cursor_x`/`cursor_y`): a capture restores the grid but not the cursor, and a live inline TUI's next
`%output` redraws **relative to the cursor** (Ink erases its previous frame by moving up from where it left off,
which sits on the input line *above* the trailing hint rows, not at the body's end). Leaving the cursor at the
body's end would make the resumed redraw erase the wrong rows and **double the bottom UI**. This bites on **any**
re-seed the TUI gets no SIGWINCH for — copy-mode exit (held-back `%output` resumes), a **reconnect**'s full
frame, or an unsolicited layout-change — so a fresh session on a deploy garbles without anyone scrolling (a
resize *does* self-correct: the SIGWINCH makes the TUI full-redraw). The cursor restore fixes every trigger at
the one choke point.

## scrolling — the pane's real history, through tmux

The browser never decides which scroll mechanism owns the pane. It sends the wheel to the bridge, and the
bridge decides from tmux's live pane flags:

- **Normal-screen pane** (a shell, a log): its history lives in tmux's scrollback. Wheel-up enters tmux
  copy-mode and scrolls that tmux view; wheel-down continues in copy-mode until the bottom. Each move repaints
  the browser from tmux's current copy-mode window: the bridge reads tmux's `scroll_position` / pane height
  and captures that exact history slice, because tmux's plain `capture-pane` still describes the bottom screen
  rather than the copy-mode viewport. While copy-mode owns the view, live `%output` from the underlying grid is
  held back from viewers and repaint frames own the screen; exiting copy-mode snaps the browser back to the
  live bottom view. The freeze flag has one ordered writer — the repaint that read the pane — so racing mode
  flips cannot leave the live tail frozen by a stale reading. So the dashboard feels like a real tmux client
  rather than a page scrolling an xterm buffer. The browser xterm keeps no independent terminal scrollback/scrollbar.
- **Full-screen TUI** (alternate screen, owns the mouse — e.g. Claude Code): it keeps **no** scrollback in
  xterm to scroll, and scrolls *itself* on mouse input. So when the pane advertises SGR mouse reports, the
  bridge injects the matching wheel report into the pane (`send-keys`), so the **app scrolls its own real
  history**.

The socket still carries no keyboard input — the wheel is the one navigation exception — and neither path is
harness-specific. Claude Code and Codex differ only in the tmux flags their panes expose.
