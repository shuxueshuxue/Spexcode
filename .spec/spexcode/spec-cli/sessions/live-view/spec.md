---
title: live-view
status: active
hue: 280
desc: The dashboard keeps browser terminals ready, but a session owns one native tmux stream only while visible; cached pixels make return switches instant and SpexCode never splices a reconstructed screen into live output.
code:
  - spec-cli/src/pty-bridge.ts
related:
  - spec-cli/src/pty-helper.mjs
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-cli/src/index.ts
  - spec-cli/test/pty-bridge.attach-repaint.ts
  - spec-cli/test/pty-bridge.cold-incremental.ts
  - spec-cli/test/pty-bridge.atomic-repaint.ts
  - spec-cli/test/pty-bridge.fd-leak.ts
  - spec-cli/test/pty-bridge.foreign-instance.ts
  - spec-cli/test/pty-bridge.history.ts
  - spec-cli/test/pty-bridge.osc8.ts
  - spec-cli/test/pty-bridge.visibility-lifecycle.ts
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

Native attach is the same repaint transaction, not a bypass around it. If attaching the visible helper leaves
tmux geometry unchanged, the first complete native transaction is released directly. If attach changes
geometry, its intermediate native screen and any delayed application clear remain behind the same semantic or
bounded barrier used by an active resize. The released repaint is a cumulative native batch from the attach
channel's byte zero: its terminal-mode setup, full repaint, every later incremental update, and any in-flight
tail are delivered in order. The bridge never selects only the last transaction, because a busy pane may
append a cursor or spinner diff behind the full repaint; that diff is not a self-contained screen for an empty
browser terminal.
That byte-zero attach batch is released only with its grid commit: the browser opens one outer synchronized
hold before applying the size and bytes, so an early alt-screen or cursor-mode prefix cannot paint a blank
intermediate over cached pixels before the batch's full repaint lands.

A pipe-transported tmux control observer accompanies the native client as a **barrier sensor only**. It
never paints, captures, sizes, or reconstructs a screen; it watches the pane's raw VT stream for the standard
DEC synchronized-output boundary. Once a pane has demonstrated that capability, resize temporarily withholds
native-client bytes until the next post-resize begin/end pair completes, discards the intermediate client
clear/redraws, then requests one final in-band native-client refresh. Bytes remain withheld until that native
client produces one complete outer begin/end transaction. Refresh command completion does not imply that its
PTY bytes have drained, so a bounded transport window coalesces already-queued chunks. Once completion is
known, this mid-stream buffer resumes at its first complete outer begin boundary and releases through its
current end in original byte order, including the refresh repaint, later complete incremental updates, and any
in-flight tail. It never feeds an orphan prefix whose beginning was discarded, or discards a later partial
suffix merely to choose a convenient transaction. This closes the real asynchronous gap:
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

Each live session keeps one stable browser terminal and terminal socket across visibility changes. Hidden pane
layers remain laid out at the terminal panel's real geometry under `visibility:hidden`, so xterm can fit
locally without becoming visible or interactive. A pane that has already been viewed retains its last painted
buffer; switching back exposes those cached pixels on the first browser paint while the native stream resumes
behind them. Activation never disposes the renderer, exposes an empty replacement canvas, or waits for a new
WebSocket.

## isolated helper

The backend process never owns a PTY. When the first viewer of a session becomes visible, it starts one shared
helper process, and only that helper creates the native tmux client. A helper creates exactly one PTY and starts
no later subprocess, so
no sibling tmux client can inherit an earlier PTY master. Losing one helper can therefore detach only its
own client; it cannot keep a dead sibling terminal alive and eventually block the shared tmux server.

The helper's stdout is raw terminal output and its stdin is a small resize/navigation control stream.
Closing the parent pipe kills the helper and its PTY, including on backend restart. UTF-8 locale is explicit
at the tmux boundary so wide characters are not replaced by host-locale fallbacks.

The browser view contains the pane, not tmux's client chrome. Before native attach the helper disables the
target session's status line, so a browser grid of N rows gives the pane N rows instead of N-1 pane rows plus
a styled tmux status row. This is a session option at the tmux boundary, not a browser crop or colour filter;
later human attaches to that SpexCode-owned session see the same status-free pane.

## one visibility lifecycle

Browser readiness and native rendering have deliberately different lifetimes. Every live session mounts its
xterm and opens its socket when the dashboard loads; this is the lightweight prewarm that removes connection
setup from a tab click. A hidden subscription creates no helper, consumes no pane output, and never votes on
tmux geometry. The first visible viewer creates the helper at its already-measured grid. The last visible
viewer releases it even though hidden sockets and xterm buffers remain alive.

Visibility is the only helper lifecycle switch. A visible claim always carries the viewer's measured grid;
that one resize message both creates the helper when needed and owns later geometry transactions. Hiding the
viewer releases the helper when no visible claim remains. There is no second prewarm protocol. Multiple visible
viewers of one session share the backend's helper at the smallest visible rows and columns, so its one grid fits
every viewer and no narrower browser clips the right or bottom edge. Hiding or detaching the limiting viewer
recomputes that same minimum and lets the remaining viewers expand. A viewer joining an existing helper receives
an explicit native-client refresh through that same raw stream; there is no capture path. A hidden dashboard
cannot resize or otherwise perturb a session watched by another dashboard.

## navigation and recovery

Wheel coordinates become terminal mouse reports written to the real tmux client. tmux itself decides
whether they scroll copy-mode history or pass through to a mouse-owning full-screen application. The
browser keeps no independent scrollback and the bridge does not inspect pane mode or reconstruct a
copy-mode viewport.

Viewer subscriptions belong to the session id rather than a helper process. If a visible helper exits,
an alive-gated, rate-limited restore creates a new one beneath the same open sockets; native attach repaints
the complete screen. A small fixed-point scan closes the two recovery transitions that have no reliable edge:
a synchronous helper spawn failure, and a one-shot restore declined while the session is transiently offline.
It checks only whether a visible subscription lacks a helper; it never polls output or refreshes an intact
pane. A hidden subscription does not trigger restoration. A dead session is reaped, not respawned. Backend
process restart remains the genuine socket break and is recovered by [[reconnect]].

## non-responsibilities

The bridge does not parse application-specific screen shapes or maintain a second terminal state for snapshots.
The bounded unsynchronized compatibility window is explicitly weaker than the DEC 2026 event path; it neither
claims application completion nor grows into an open-ended settle loop.
For a session that has never been viewed, the contract is a short native attach followed by one complete paint,
not zero attach latency. Lightweight browser prewarm must not hide that cold path from evaluation.
