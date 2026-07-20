---
title: live-view
status: active
hue: 280
desc: The dashboard terminal follows one warm native tmux client stream per live session; isolated helpers preserve instant tab switches, geometry has one warm owner, and SpexCode never splices a reconstructed screen into live output.
code:
  - spec-cli/src/pty-bridge.ts
related:
  - spec-cli/src/pty-helper.ts
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-cli/src/index.ts
  - spec-cli/test/pty-bridge.atomic-repaint.ts
  - spec-cli/test/pty-bridge.fd-leak.ts
  - spec-cli/test/pty-bridge.foreign-instance.ts
  - spec-cli/test/pty-bridge.history.ts
  - spec-cli/test/pty-bridge.osc8.ts
  - spec-cli/test/pty-bridge.prewarm.ts
  - spec-cli/test/pty-bridge.reseed-reconnect.ts
  - spec-cli/test/pty-bridge.scroll-redraw.ts
  - spec-cli/test/pty-bridge.stress.ts
  - spec-cli/test/pty-bridge.unsynchronized-repaint.ts
---

# live-view

The dashboard terminal is a browser view of a session's tmux pane. Prompts still travel through the
session dispatch channel; the terminal socket carries pane output, geometry, visibility, and wheel
navigation only.

## one compositor

Each session has at most one native tmux client per backend instance, shared by that instance's viewers.
Its PTY output is the only terminal byte stream sent to xterm. SpexCode does not capture the pane, rebuild
terminal modes or cursor state, clear the browser, and then splice raw pane output behind that synthetic
frame. tmux already owns the pane grid, history, cursor, modes, and client rendering; the bridge transports
that client rendering instead of becoming a second terminal emulator.

This boundary also owns resize as one transaction. The browser measures the desired grid without first
reflowing xterm's old buffer, and the bridge resizes the native client PTY. Once the final native tmux
transaction is ready, the bridge commits its grid dimensions immediately before those bytes; xterm changes
grid and applies the transaction under one synchronized-output hold. Until then the already-painted buffer
remains visible. A TUI may respond to `SIGWINCH` immediately or later, but neither an eager browser reflow nor
an extra full-screen snapshot becomes an intermediate frame.

A pipe-transported tmux control observer accompanies the native client as a **barrier sensor only**. It
never paints, captures, sizes, or reconstructs a screen; it watches the pane's raw VT stream for the standard
DEC synchronized-output boundary. Once a pane has demonstrated that capability, resize temporarily withholds
native-client bytes until the next post-resize begin/end pair completes, discards the intermediate client
clear/redraws, then requests one final in-band native-client refresh. Bytes remain withheld until that native
client produces one complete outer begin/end transaction. Refresh command completion does not imply that its
PTY bytes have drained, so a 15 ms transport window coalesces already-queued chunks and releases only the last
complete transaction, never racing the observer or command reply against a second output stream. This closes the real asynchronous gap:
an application may clear before opening its synchronized redraw 55ms later, while tmux otherwise renders the
clear as its own complete update. Completion is the application's explicit end event, not silence or a guessed
settle duration. A bounded fail-open refresh recovers a broken/missing end marker; it is not the normal path.

A pane that has not demonstrated synchronized output has no semantic redraw-complete event. For that legacy
case only, resize coalesces native updates behind the old visible buffer until either 160 ms of output
quiescence or a 400 ms ceiling, then requests the same complete native refresh transaction. This bounded
compatibility window prevents a common delayed clear from becoming a browser frame without pretending that
silence is an application guarantee. Once the pane demonstrates DEC 2026, later resizes use the event path.

The browser uses a terminal engine that implements synchronized output. When an application marks a VT
transaction with DEC mode 2026, rendering is held until that transaction ends; xterm's own write queue may
batch transport chunks, but it is never a substitute for a terminal protocol boundary.

Each warm xterm keeps one stable renderer across visibility changes. Tab activation refreshes that existing
renderer before the browser's first visible paint; it does not dispose one renderer, expose an empty canvas,
and asynchronously install another. Hidden pane layers remain laid out at the terminal panel's real geometry
under `visibility:hidden`, so their buffers render warm without becoming visible or interactive. A hidden
helper that owns its session's geometry also follows panel resizes and completes the native resize transaction
before a later click; activation changes visibility rather than creating the renderer's first measurable box
or catching its grid up on demand.

## isolated helper

The backend process never owns a PTY. When the first warm socket subscribes to a session, it starts one shared
helper process, and only that helper creates the native tmux client. A helper creates exactly one PTY and starts
no later subprocess, so
no sibling tmux client can inherit an earlier PTY master. Losing one helper can therefore detach only its
own client; it cannot keep a dead sibling terminal alive and eventually block the shared tmux server.

The helper's stdout is raw terminal output and its stdin is a small resize/navigation control stream.
Closing the parent pipe kills the helper and its PTY, including on backend restart. UTF-8 locale is explicit
at the tmux boundary so wide characters are not replaced by host-locale fallbacks.

## warm terminals and size ownership

The dashboard keeps every live session pane mounted, so the bridge keeps one helper warm for every live
session socket too. Pane output and owner-approved geometry changes continue to update its hidden xterm
buffer. Switching tabs therefore uses the existing native client and existing browser terminal immediately;
it never pays a detach/attach or first-visible resize cycle.
The native helper cost is deliberately paid per live dashboard session to preserve this interaction
contract, then released when the session socket unmounts.

Warm geometry has one owner. If no existing tmux client owns a session's size, the first hidden helper votes
at its measured panel geometry and prepares the pane before any click; activation then changes visibility
without a pane replay. If a size-owning client already exists, a later hidden helper attaches with
`ignore-size` and cannot disturb it. A visible viewer always votes. A helper that was elected while hidden
retains ownership across local tab switches, while an initially visible or foreign-neutral helper becomes
neutral when its viewer hides. Thus one dashboard gets a genuinely final prewarmed grid and a second dashboard
can prewarm the same session without collapsing the window watched by the first one.

Multiple viewers of one session share the same helper and latest visible size. A later viewer joins the
same in-band tmux stream; an explicit tmux client refresh supplies its blank xterm without introducing a
capture path. If all clients are warm and neutral, tmux may retain their last geometry until one becomes
visible and votes.

## navigation and recovery

Wheel coordinates become terminal mouse reports written to the real tmux client. tmux itself decides
whether they scroll copy-mode history or pass through to a mouse-owning full-screen application. The
browser keeps no independent scrollback and the bridge does not inspect pane mode or reconstruct a
copy-mode viewport.

Viewer subscriptions belong to the session id rather than a helper process. If a warm helper exits,
an alive-gated, rate-limited restore creates a new one beneath the same open sockets; native attach repaints
the complete screen. A dead session is reaped, not respawned. Backend process restart remains the genuine
socket break and is recovered by [[reconnect]].

## non-responsibilities

The bridge does not parse application-specific screen shapes or maintain a second terminal state for snapshots.
The bounded unsynchronized compatibility window is explicitly weaker than the DEC 2026 event path; it neither
claims application completion nor grows into an open-ended settle loop.
