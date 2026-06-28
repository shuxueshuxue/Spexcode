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
to (per session, with a global fallback; only a session no viewer has *ever* sized falls back to a fixed
default). The supervisor does not merely spawn a fresh bridge at that size — it **keeps existing warm
bridges at it**, resizing a stale one off-screen while no one is watching. So when a viewer attaches, the
pane is *already* its size: the open-time fit matches, tmux re-wraps nothing, and the human sees one clean
repaint — never a visible cols/rows reflow settling in after the fact. The on-attach resize is the reflow;
pre-sizing the warm client is what removes it. Only the first open of a never-sized session pays it once.

The client is forced to **UTF-8** (`tmux -u` plus a UTF-8 `LANG`), independent of the host's locale. Without
that, a backend launched with an empty/non-UTF-8 environment (e.g. a macOS LaunchAgent, where `LANG=""`)
makes tmux substitute `_` for every wide character — CJK, `▸`, `★`, … — in the bytes it streams to the
browser, even though the pane itself stores them correctly. Forcing it here keeps the live terminal
glyph-faithful wherever the backend runs.

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

Every (re)attach paints through a single tmux `refresh-client` at the settled pane size — one coherent
full frame down the same pty the live bytes flow on. We never splice a `capture-pane` snapshot into the
mid-flight stream; that out-of-band join was the historical screen-scramble, and the durable-subscription
path never reintroduces it.
