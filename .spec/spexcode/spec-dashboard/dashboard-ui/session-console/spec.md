---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionTerm.jsx
---

# session-console

## raw source

`Enter` on the board opens the session interface; the always-on top-right window is the at-a-glance
summary. Both are thin views of the backend's session state — the dashboard renders whatever
`/api/board` (i.e. `spex board`) reports, so a human watching the dashboard and an agent driving the
same sessions through the CLI see identical state. The dashboard never invents session state.

## expanded spec

The interface is two panes: a left session list and a right content area that **morphs** by what's
focused. "New Session" shows a centered avatar + input (sitting a little above centre), prefilled with the
focus node as an editable `@node` reference (a convenience — a session may touch any nodes, so the prefix is
deletable); launching switches to the new session. The new-session box **auto-grows** to fit its content as
lines wrap or newlines are added (and shrinks back as text is deleted), up to a max height past which it
scrolls — the growth is smoothed. Typing `@` in that prompt opens an **@-mention completion**: a dropdown of
spec nodes filtered by what follows it, **matched against the node's id and its spec path** (so a partial
path like `@spec-cli` surfaces a whole subtree, not just an id), best matches first. Picking one (↑/↓ then
⏎/⇥, or click) drops a clean `@<id>` token in place of the partial. It is a deliberately narrow,
keyboard-first affordance: the menu opens only on an `@` that **begins a word** (never mid-token, so an
email address can't trigger it), owns ↑/↓/⏎/⇥/Esc while open, and closes once the token is complete or the
caret leaves it. It is pure assistance — the reference is still just text the human can edit or delete. The
box's hint says only that the prompt is `@node`-prefixed and the prefix is deletable; it does not name the
launch command. An existing session shows its **live tmux terminal** (SessionTerm) — a
**read-only view** — with the **single human input** docked at the bottom.

The terminal is a **real tmux client**, not an output tap, but it is a **pure scrollable view**: the
human never types into it. SessionTerm opens a **read-only** xterm (`disableStdin`) wired to one
**WebSocket** (`/api/sessions/:id/socket`) that the backend bridges to a genuine `tmux attach` client
(see the `sessions` node's `pty-bridge`). Over that socket, server→client is raw pane bytes (binary)
written straight to xterm with **no clear**, and the client sends only a single text control frame
(`{t:'resize',cols,rows}`) plus — exclusively on behalf of the bottom message box — the line a human
typed. **No keystrokes or mouse are forwarded from the terminal itself.** Because nothing types into the
view, scrolling it can never block input: **xterm owns its own scrollback** and the mouse wheel scrolls
that viewport natively (SessionTerm returns `false` from a custom wheel handler so tmux's mouse mode can't
steal the wheel). The pane is **dark** (a solarized-dark xterm theme on a dark background) even though the
surrounding dashboard is light: the Claude Code TUI running inside is **designed for a dark terminal**, so a
light pane would clash with its diff-add backgrounds, dim/faint context text, and syntax colors. The whole
terminal area — xterm, its viewport, and the body it sits in — shares that dark background so no light gutter
flashes around the pane. A (re)joining viewer is painted by a **single coherent full repaint, never a snapshot
spliced into the live stream** (that splice was the tab-switch scramble — an out-of-band `capture-pane`
snapshot merged into mid-flight deltas, joining at a different cursor/size and even mid-escape-sequence). On
(re)connect the client **resets its xterm** to a blank screen and the bridge asks tmux to **`refresh-client`**
its attach client, emitting one full in-band redraw down the same pty the live deltas flow on — coherent with
them by construction. The redraw reaches every viewer of that shared client (a brief, harmless re-paint),
which is acceptable; there is no per-viewer partial seed, so rapid tab-switching leaves no half-painted state.
The terminal
**scales to its panel** — the FitAddon fits xterm to the container and each fit sends the new cols×rows
over the socket so tmux re-renders at exactly that size (only when it changed). The fit is **robust against
the open entrance**: the panel animates in (`si-expand`, a fade + rise — deliberately **not** a `scale()`,
which would distort xterm's cell measurement mid-animation), and SessionTerm **never propagates a degenerate
fit** — it skips any measurement against a near-zero (hidden / unlaid-out) host or an implausibly small col
count for a clearly-wide host, and **re-fits after the entrance settles** (on `animationend` plus scheduled
re-fits across the .22s) so the final size locks tmux to the true full width, never a narrow strip. The
panel clips horizontally; the xterm viewport is the only scrollbar.

There is exactly **one human input**: the docked `❯` box at the bottom. Submitting it writes the typed
line **followed by Enter** into the active session's pane over the **same socket the terminal already
holds** (each mounted SessionTerm registers a `send` writer in the interface's `sendersRef`, keyed by
session id), falling back to `POST /api/sessions/:id/keys` only when that socket isn't open yet.

Switching tabs is **instant** and never loses your place: every session terminal you've opened stays
**mounted but hidden** (its WebSocket and scroll position survive), and the backend keeps a **warm tmux
client** per live session, so first-open and re-open both paint immediately instead of cold-starting a
capture + spawn chain. List navigation is handled at the **window** level so arrows keep walking the list
regardless of what holds focus (xterm included), and the selected tab persists across open/close.
Lifecycle actions (relaunch / merge / back-to-working / close) sit in the header per the
session's state; an offline session shows a relaunch panel instead of a dead terminal. There is **no
manual "request review" button** — review is **agent-proposed**: an agent proposes review of its own work
at the stop-gate (`session done --propose merge`), so a human button to force `working`/`idle` → `review`
would be redundant. The header therefore only surfaces actions a human still drives (relaunch a dead
worktree, accept/reject a pending proposal, close), and a session still reaches `review` purely through the
agent's proposal. SessionWindow is
the read-only glance: every session with its status dot and pending-op count, click to highlight that
worktree's overlays on the board (and focus its first changed node).

`SessionInterface.jsx` is the `Enter` modal: `order = ['new', ...session ids]` with `active` clamped to
a real tab. The New tab prefills a `@${focusId}` reference (keyed on `focusId`, not the focus object, so
board polling can't wipe typing) and submitting POSTs `/api/sessions` then switches to the returned id.
An existing tab renders a **persistent stack** of `SessionTerm`s — one per session you've opened, only the
active one shown — over the offline relaunch panel when the active session is `offline`; the docked `❯`
textarea's Enter is the **only** input, pushing the line + Enter through the active terminal's registered
socket writer (`sendersRef`), with `POST /api/sessions/:id/keys` as the not-yet-connected fallback. The
header buttons map to the session's status (relaunch / merge / back-to-working / close), each a
thin POST then a board reload (there is no `review` button — that transition is agent-proposed, not human). A window-level capture listener owns `↑`/`↓` list movement and Enter-on-New; while it is open the
interface owns **all** its keys — the board delegates `Esc` to it, which the @-mention menu claims to
dismiss itself before it falls through to closing the interface.
`SessionTerm.jsx` opens a **read-only** (`disableStdin`) FitAddon-sized xterm, fits it to the panel on open
and on container/window resize (sending the new cols×rows only when it changed) while guarding against
degenerate measurements and re-fitting after the open animation so it reliably fills at full width, and
wires xterm to the session WebSocket: incoming binary frames are written straight to xterm. It forwards **no** keyboard/mouse;
instead it registers a `send(text)` writer (raw bytes over the socket) for the bottom box, and scrolls via
xterm's own scrollback (custom wheel handler returns `false`). `SessionWindow.jsx` is the top-right floater of status-dot
rows with a pending-op glyph count, highlighting a worktree's overlays on pick and opening the interface
on open. All of this renders only what `/api/board` reports — no session logic lives in the dashboard —
so the raw source (a thin view identical to `spex board`) holds.
