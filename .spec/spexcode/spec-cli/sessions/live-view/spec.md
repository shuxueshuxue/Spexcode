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
  - spec-dashboard/scripts/patch-xterm-sync-resize.mjs
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

This boundary also owns every geometry delivery. A visible claim, a font-size change, and a browser resize all
reduce to one measured grid request; the browser does not first reflow xterm's old buffer. The helper acknowledges
only after its PTY has adopted a requested size, and the bridge then refreshes that same native client. Repeated
geometry requests serialize behind the refresh already running and end with a refresh for the latest acknowledged
grid, rather than racing independent resize and refresh channels.

One native stream follows three phases after each geometry request. In `initial`, the bridge buffers from the
current stream position and records its offset when the native client's explicit `refresh-client` command
completes. The first complete tmux synchronized-output transaction that begins after that offset is the forced
full-client repaint, not an earlier busy-pane tick. The bridge commits the shared grid and releases the ordered
prefix through that transaction as the fast complete screen. Native attach uses the same phase, so setup bytes
before the repaint are retained and a blank browser never receives only a trailing spinner diff.

The bridge then enters `quarantine` until one fixed 400 ms boundary measured from the latest geometry request.
All native bytes in that bounded interval remain ordered but withheld. At the boundary they are sent once with
another transaction marker, so an application clear and a redraw 55 ms later are parsed before one browser paint.
If no sound initial transaction arrives, the same boundary is the fail-open: it commits and releases what exists
rather than freezing forever. After the boundary the bridge enters `stream` and forwards ordinary bytes without
delay until the next geometry request.

The fixed boundary is not an application detector. Whether an application answers `SIGWINCH`, and when, is
unobservable and unbounded outside that application; a quiet period cannot distinguish "done" from "redraw begins
next tick." tmux DEC 2026 pairs delimit that client's render cycles, not an application's logical redraw, and a
busy spinner can add unrelated cycles. SpexCode therefore does not run a second control-mode client, learn an app
capability, or infer semantic completion from another byte stream. The native helper stream is the only stream
examined, buffered, and released.

The browser terminal implements synchronized output, but mode 2026 is boolean rather than nested. A large xterm
write is also parsed in time-sliced chunks, so an inner tmux `2026l` can otherwise close an outer geometry hold and
paint half of one WebSocket frame. Each bridge transaction is consequently serialized in the browser: one outer
hold covers its grid change and complete parse, and only that frame's inner 2026 markers are consumed until the
outer hold closes. Ordinary streamed frames are not wrapped or filtered and retain tmux's native synchronized
semantics. No renderer clone, screen capture, DOM latch, or reconstructed terminal state participates.

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
viewer releases the helper when no visible claim remains. A browser viewer is visible only while both its
dashboard session layer and its document are visible. Backgrounding the browser tab therefore withdraws the
same claim: the socket and cached xterm remain, but no pane deltas accumulate for replay. Returning exposes the
      cache immediately and the ordinary measured resize recreates the native helper, whose initial repaint replaces it
with the current tmux screen. There is no resume replay or page-specific repaint protocol. There is no second
prewarm protocol. Multiple visible
viewers of one session share the backend's helper at the smallest visible rows and columns, so its one grid fits
every viewer and no narrower browser clips the right or bottom edge. Every joining viewer receives the shared
      grid commit with the refreshed transaction even when that grid did not change, so local fit dimensions can never
survive beside a different tmux grid. In a larger host the smaller shared grid is bottom-left aligned: ordinary
remainder space stays above or to the right, while the terminal's last row still meets the input strip. Hiding
or detaching the limiting viewer recomputes that same minimum and lets the remaining viewers expand. There is no
capture path, and a hidden dashboard cannot resize or otherwise perturb a session watched by another dashboard.

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

The bridge does not parse application-specific screen shapes, correlate incidental application transactions to
resize, or maintain a second terminal state for snapshots. Its fixed stabilization boundary is explicitly a
liveness compromise over a protocol with no redraw-complete event; it never claims semantic application
completion or grows into an open-ended settle loop. An unsynchronized application that waits beyond 400 ms
before clearing and redrawing may still expose that later clear as steady-state output. Eliminating an arbitrarily
late clear requires application-level synchronized output; no bounded external bridge can infer it.
For a session that has never been viewed, the contract is a short native attach followed by one complete paint,
not zero attach latency. Lightweight browser prewarm must not hide that cold path from evaluation.
