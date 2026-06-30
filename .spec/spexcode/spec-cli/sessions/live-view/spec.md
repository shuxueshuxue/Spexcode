---
title: live-view
status: active
hue: 280
desc: The dashboard's live terminal — one real tmux client per session, with viewer subscriptions that outlive the client so a pane never freezes.
code:
  - spec-cli/src/pty-bridge.ts
---

# live-view

The dashboard's **live terminal** is a read-only browser view of a session's tmux pane, carried over one
bidirectional WebSocket per session. Server→client is raw pane bytes; the human never types *into* the
view (prompts travel out-of-band — see [[dispatch]]). It is a genuine tmux client, not an output tap.

## the bridge

Behind each session is exactly **one** real tmux client (a `node-pty` running `attach-session`), shared by
every browser viewer of that session — so there is one authoritative pane size and never a size-fight. A
supervisor keeps a **warm** client for every *detached* live session, so opening a tab paints instantly,
and deliberately **skips** any session a human is already attached to in their own terminal.

The warm client is held at the **last-known viewer size** — the most recent size any dashboard pane fitted
to (per session, with a global fallback; a never-sized session falls back to a fixed default). The supervisor
keeps existing warm bridges at it, resizing a stale one off-screen, so a warm pane is *already* roughly the
dashboard's size before anyone looks — the server's best guess, which the handshake below then makes exact.

## the size-first handshake

The authority on a viewer's size is the viewer, and it knows that size **before** the first frame is drawn —
so it carries it **on the connection itself**: the browser hands its real size to the socket and the server
draws that very first frame at it, never the guessed-size full frame. So the first frame can no longer land
garbled on a still-default xterm and need a second, post-fit frame to clean it up — that scramble-then-recover
is gone. The handshake is **carry-if-known, never block**: a client that cannot yet measure its pane (mid
entrance-animation) omits the size and the server falls back to one repaint at the warm size — the old
behaviour, never a blank pane. The size is re-resolved on **every (re)connect**, so a reconnect after a
resize still hands over the live size. The client's own fit-retry stays the **corrective** path that
converges a size measured slightly wrong mid-animation: the handshake removes the *guaranteed* first
scramble, the retry covers the residual.

The client is forced to **UTF-8** (`tmux -u` plus a UTF-8 `LANG`), independent of the host's locale —
otherwise a backend launched with an empty/non-UTF-8 environment (e.g. a macOS LaunchAgent) makes tmux
substitute `_` for every wide character in the stream, even though the pane stores it correctly. Forcing it
here keeps the live terminal glyph-faithful wherever the backend runs.

## the durable-subscription invariant

A viewer subscribes to a **stable session id**, never to the bridge instance. The subscription **outlives
any number of bridge deaths and respawns**: when the tmux client exits — the session's window finishing, a
tmux hiccup, supervisor churn — the bridge is replaced underneath, and the surviving viewers are
transparently re-bound to the new client and repainted **on the same open socket**. Bridge replacement is
therefore invisible to the browser, so a live session's pane can never be left frozen, inactive, or
unscrollable, and **client reconnection is unnecessary for bridge churn**. (This is structural: a viewer
and a bridge no longer share a lifetime, so no bridge-lifecycle event can strand a viewer.)

Re-bind is owned by the supervisor's reconcile pass, which is **alive-gated** — a session that has genuinely
died is reaped and its pane goes quiet rather than respawning into a storm — and **rate-limited**, so a
flaky session cannot fork-bomb the tmux server. The repaint that lands on every (re)attach is **fail-loud**:
it must actually fire, because an idle re-bound pane has nothing else to re-arm it.

The **only** intentional socket close is the human closing the pane (the board flipping a session to
`offline`, which swaps the terminal for the relaunch panel). A backend *process* restart is the lone case
that genuinely drops the socket; recovering from it is a trivial, stateless reopen of this same stable-id
endpoint, and lives with the client, not here.

## coherence

Every (re)attach paints through a single tmux `refresh-client` — one coherent full frame down the same pty
the live bytes flow on — at the size the client handed over on connect (or, absent a handshake, the warm
size). We never splice a `capture-pane` snapshot into the mid-flight stream; that out-of-band join was one
historical screen-scramble, and a first frame drawn at a guessed size onto a still-default xterm was the
other — the size-first handshake closes the second the way the durable-subscription path closes the first.
