---
title: live-view
status: active
hue: 280
desc: Every visible browser viewer is one real tmux client whose PTY, size, input, output, and lifetime stay bound to that viewer; tmux arbitrates concurrent screens natively.
code:
  - spec-cli/src/pty-bridge.ts
related:
  - spec-cli/src/pty-helper.mjs
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-dashboard/test/terminal-multi-viewer.e2e.mjs
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
  - spec-cli/test/terminal-socket-lifecycle.ts
  - spec-cli/test/pty-bridge.reseed-reconnect.ts
  - spec-cli/test/pty-bridge.scroll-redraw.ts
  - spec-cli/test/pty-bridge.stress.ts
  - spec-cli/test/pty-bridge.unsynchronized-repaint.ts
---

# live-view

The dashboard terminal is an interactive browser face of a session's tmux pane. xterm's native input travels
through the terminal socket beside pane output, geometry, visibility, and wheel navigation. Atomic authored
prompts and board commands remain [[command-box]]'s separate session dispatch channel.

## one native compositor per viewer

Each visible browser viewer has exactly one native tmux client. Its PTY output is the only terminal byte stream
sent to that viewer's xterm, and that xterm's input returns through the same PTY. Browser viewers never share a
synthetic broadcast stream or collapse their independent client sizes into a bridge-owned grid. SpexCode does not capture the pane, rebuild
terminal modes or cursor state, clear the browser, and then splice raw pane output behind that synthetic
frame. tmux already owns the pane grid, history, cursor, modes, and client rendering; the bridge transports
that client rendering instead of becoming a second terminal emulator.

This boundary also owns every geometry delivery. A visible claim, a font-size change, and a browser resize all
reduce to one measured grid request; the browser does not first reflow xterm's old buffer. The helper acknowledges
only after its PTY has adopted a requested size, and the bridge then refreshes that same native client. Repeated
geometry requests serialize behind the refresh already running and end with a refresh for the latest acknowledged
grid, rather than racing independent resize and refresh channels.

Each native stream follows three phases after its geometry request. In `initial`, the bridge buffers from the
current stream position and records its offset when the native client's explicit `refresh-client` command
completes. The first complete tmux synchronized-output transaction that begins after that offset is the forced
full-client repaint, not an earlier busy-pane tick. The bridge commits that viewer's grid and releases the ordered
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

The backend process never owns a PTY. When a viewer becomes visible, its subscription starts one helper process,
and only that helper creates that viewer's native tmux client. A helper creates exactly one PTY and starts no
later subprocess, so
no sibling tmux client can inherit an earlier PTY master. Losing one helper can therefore detach only its
own viewer; it cannot keep a dead sibling terminal alive or leave another browser's attach state behind.

The helper's stdout is raw terminal output and its stdin is a small resize/navigation/input control stream.
Closing the parent pipe kills the helper and its PTY, including on backend restart. UTF-8 locale is explicit
at the tmux boundary so wide characters are not replaced by host-locale fallbacks.

The visible viewer may send bounded `{t:'input', data}` messages on its existing socket. The bridge preserves
their order and hands each xterm-produced byte string to the helper, which writes it to the native client's PTY.
This is the same client whose stdout paints xterm, so terminal modes, paste protocol, control keys, and IME
commits are decided by xterm and the TUI rather than re-encoded by the dashboard. Hidden, lingering, detached,
or disconnected viewers cannot inject and never queue input for later replay.

The browser view contains the pane, not tmux's client chrome. Before native attach the helper disables the
target session's status line, so a browser grid of N rows gives the pane N rows instead of N-1 pane rows plus
a styled tmux status row. This is a session option at the tmux boundary, not a browser crop or colour filter;
later human attaches to that SpexCode-owned session see the same status-free pane.

## one viewer lifecycle

Browser readiness and native rendering have deliberately different lifetimes. Every live session mounts its
xterm and opens its socket when the dashboard loads; this is the lightweight prewarm that removes connection
setup from a tab click. A hidden subscription creates no helper and owns no tmux client. Becoming visible
creates that subscription's helper at its already-measured grid. Hiding arms one bounded linger window instead
of an instant release: that viewer's helper stays alive and its stream keeps flowing into its hidden but still-
mounted xterm, so a quick return continues in place. Expiry releases only that viewer's helper even though its
socket and xterm remain alive.

Visibility is the helper lifecycle switch, and the linger window is its one bounded hysteresis. A visible
claim always carries that viewer's measured grid; the same resize message creates or resizes its native client.
A claim inside the linger window at the unchanged grid simply resumes, while a changed grid takes the ordinary
native repaint path. A browser viewer is visible only while both its dashboard session layer and its document
are visible. Backgrounding the browser tab therefore withdraws the claim. Past the window the socket and cached
xterm remain but its tmux client does not; returning exposes the cache immediately, then native attach replaces
it with the current screen. Lingered bytes are written as they arrive, never queued for fast-forward.

Concurrent visible viewers use tmux's classic multi-client model. The session window uses `window-size largest`:
the largest attached client owns the application's one possible PTY geometry, so a real large display is never
shrunk by a smaller peer. Each client still renders at its own outer-terminal grid; a smaller viewer receives
tmux's native viewport into the larger window rather than forcing every viewer to the smallest dimensions.
`Ctrl+b z` remains tmux's pane-layout zoom and is not repurposed as a size-arbitration command. When the largest
client hides, disconnects, or dies, tmux removes that client and naturally recomputes from those that remain.
SpexCode does not implement a parallel min/max/latest vote or broadcast one client's bytes to another.

The terminal WebSocket and its native client have the same owner. An ordinary close removes the subscription
and helper immediately, with no linger for a dead viewer. Silent half-open links are bounded by a bidirectional
heartbeat: every server ping requires a browser pong, and a server-side deadline forcibly removes the viewer and
kills its helper even if the transport never produces `close`. A stale browser can therefore never leave a
ghost tmux client or geometry vote behind indefinitely.

## navigation and recovery

Wheel coordinates become SGR-encoded terminal mouse reports written to the real tmux client — the same
pure-ASCII form a real terminal sends, never classic X10, whose col+32 byte arithmetic crosses 0x7f past
column 95 and desyncs the client's UTF-8 input parser: wheel events get eaten position-dependently and
payload bytes leak into the pane as literal keystrokes. Browser wheel deltas
accumulate into whole tmux ticks — one per fixed pixel quantum, remainder carried, a direction flip
dropping it — so a trackpad's micro-delta momentum gesture travels proportionally instead of inflating
every event to a full tick and overshooting its return leg. A net-tick ledger finishes the return: pane
content that grows during a scroll excursion leaves an exactly-symmetric return short of the live bottom,
where a mouse-owning application's scrolled view impersonates the live tail while its in-place updates
freeze. When the ledger crosses back to zero the browser sends a bottoming burst — the natural human
overshoot restored — which is a no-op at the bottom on every pane type and never fires for a reader
parked deep in history. The browser still holds no scroll state of its own and never inspects pane
mode. tmux itself decides
whether they scroll copy-mode history or pass through to a mouse-owning full-screen application. The
browser keeps no independent scrollback and the bridge does not inspect pane mode or reconstruct a
copy-mode viewport. The pane viewport therefore clips rather than scrolls: with no xterm scrollback its
overflow is hidden on both axes, so a fractional device-pixel or geometry overshoot cannot surface a
phantom themed browser scrollbar competing with tmux's own scroll.

Viewer subscriptions belong to the session id and WebSocket rather than a replaceable helper process. If one
visible helper exits, an alive-gated, rate-limited restore creates a new helper for that same viewer; native
attach repaints the complete screen without disturbing sibling clients. A small fixed-point scan closes the two
recovery transitions that have no reliable edge: synchronous spawn failure and a restore declined while the
session is transiently offline. It checks only whether a visible subscription lacks its own helper; it never
polls output or refreshes an intact client. A hidden subscription does not restore. A dead session is reaped,
not respawned. Backend process restart remains the genuine socket break and is recovered by [[reconnect]].

## non-responsibilities

The bridge does not parse application-specific screen shapes, correlate incidental application transactions to
resize, or maintain a second terminal state for snapshots. Its fixed stabilization boundary is explicitly a
liveness compromise over a protocol with no redraw-complete event; it never claims semantic application
completion or grows into an open-ended settle loop. An unsynchronized application that waits beyond 400 ms
before clearing and redrawing may still expose that later clear as steady-state output. Eliminating an arbitrarily
late clear requires application-level synchronized output; no bounded external bridge can infer it.
For a session that has never been viewed, the contract is a short native attach followed by one complete paint,
not zero attach latency. Lightweight browser prewarm must not hide that cold path from evaluation.
