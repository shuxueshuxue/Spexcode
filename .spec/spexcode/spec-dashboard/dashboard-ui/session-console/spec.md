---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/session.js
  - spec-dashboard/src/sessionCommands.js
---

# session-console

## raw source

`Enter` on the board opens the session interface; the always-on top-left window (SessionWindow) is the
at-a-glance summary. Both are **thin views of `/api/board`** (i.e. `spex board`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

## expanded spec

The interface is a **near-fullscreen popup modal** over the dimmed board. Two panes: a left session list and a
right area that **morphs** by what's focused. The
list's **top button row** pairs `＋` New Session and the relationship-graph icon above the session rows (so
neither blocks the `↑/↓` path); New ⇄ graph is horizontal — `→` from an *empty* New enters, `←` returns.

**New Session** is a centred avatar + auto-growing input. Nothing is prefilled; the focused node is the first
**@-mention** suggestion, so the human opts in with `@`. A leading **`/`** opens the config-preset palette;
the two compose the launch grammar `/<preset> @<node>… <free text>`, from which the server derives the node (the
first `@<id>`). Both menus only insert text; the New prompt has **no** `/` slash-command menu (presets only). A preset launched with **no `@`-target** never assumes a node — the agent takes scope from the prompt, else asks first.
**Submitting launches but never switches tabs**: the prompt clears and you stay on New Session — the new session just
appears in the list below (the next board poll surfaces it) — so you can fire off several in a row. The old
auto-jump-to-the-new-session is gone; only a tab's *removal* (below) ever moves your selection for you.

**View Session Relationship** fills the pane with the live monitor graph ([[session-graph]]) — its home now,
not a `t` overlay; the board's `t`/network button open onto it, and clicking a node switches to that session's tab.

An existing session shows its **live tmux terminal** (SessionTerm) with the docked **`❯` input** below — a
**real tmux client but a read-only scrollable view** — but only when its **liveness** ([[state]]) is live
(`online`/`starting`). The terminal mount and the relaunch panel key on **liveness, never the lifecycle
label**: a session whose process is gone reads `offline` whatever its authored lifecycle (`asking`,
`review`, `error`, …), so it never mounts a tmux client against a dead id (which would leak tmux's bare
"no sessions" into the pane) — it shows the **relaunch panel** instead, offering to resume the same
conversation (the transcript and `.session/` survive — see [[runtime]]). `queued` is the one exception: it
has intentionally not launched, so it shows neither a terminal nor a relaunch, and self-starts as a slot
frees. The header bar above it (`si-th-name`) titles the
terminal with the **shared session headline** ([[session-activity]]), not the stable `sessionName` — same
source and content as the session rows, only with more room before it truncates — so the title over the
terminal never disagrees with the row that opened it. Read-only governs input, not extraction: text selects, the
wheel scrolls real history, a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard
**over HTTPS, localhost, or plain HTTP** (past the secure-context-only Clipboard API).

Input has **two channels**. The **`❯` box** is the prompt channel: submitting dispatches through the **control
socket** (never typed into the pane), so it lands even in copy-mode. The exception is the **board commands** —
a `/` line the box intercepts client-side and runs HERE instead of sending to the agent (where the word would
only drive the agent's own process, not the board). They come from **one registry** (`sessionCommands.js`) that
ALSO renders the header buttons, so each command is the **typed twin of a button** — one action, one **identity
colour**, never two codepaths. The two terminal verbs split by what they destroy: **`/exit`** stops this
session (`act('exit')`, **muted grey**) — it kills the agent + tmux but **keeps the worktree**, so the session
goes `offline` and offers **relaunch** (the same resumable stop a crash produces, see [[state]]); **`/close`**
removes it (`act('close')`, **red**) — worktree + branch gone, the work discarded, the row's right-click Close's
twin. `/merge` merges (green), `/nav` toggles nav mode (yellow), `/proof` opens the proof (cyan). In the inbox
`/` menu they **lead** the list, coloured, tagged `[board]`, apart from CC's blue command rows; accepting one
**runs** it (the one row that acts, not inserts — see [[term-input]]). Typed `/exit` and `/close` carry **no
confirm** — typing the exact command is itself the deliberate act, where the row-menu's Close guards an
easy-to-mis-aim right-click. The box **holds
focus persistently** — clicking
chrome never blurs it, the panel **suppresses the native context menu** and **restores** focus after a
right-click. It **auto-grows upward**, **capped at half** the terminal height, with New's `/` **completion**
([[term-input]]). The second channel is **nav mode** — entered by the `/nav` board command, the header
button, or the reserved `⌥/⌘+I`: the `❯` box disables and **every keystroke — `⌃`/`⌥`/`⌘` combos included —
forwards raw** to the pane, so a human drives the agent's terminal, not just its arrows. Those **reserved
`⌥/⌘+I`** keys toggle nav mode and are **never forwarded to tmux nor overridable by the app**; entry is
otherwise **manual**, and leaving the tab or going offline exits — as does a **second `Esc` within 600 ms**
(the first `Esc` still forwards to the pane to cancel the agent's own menu). A best-effort pane sniff — a
select-caret line beside an `Esc`/Enter hint line — only ever **suggests** nav mode by pulsing the nav
button, a non-authoritative nudge that never seizes keys.

A **right-click on a session row** opens its context menu — rename or close ([[session-rename]]) — coexisting
with the context-menu suppression; the shared `sessionName` puts that rename first in the label precedence.
A small **drag handle** at the far right of each row's second line reorders the list ([[session-reorder]]) —
only the handle drags, so click/double-click/`↑↓`/focus on the row are untouched.
Either input also accepts an **attached file** (paste, drop, or the 📎 picker), uploaded to the backend
(= worker) `/tmp` with its path spliced in — see [[file-attach]].

Terminals are **warm and always connected**: every live pane mounts and opens its socket when the board loads —
never lazily on focus — and stays mounted even while the console is closed, so switching tabs **never loses your
place** (socket + scroll survive), New Session included (it hides its pane). Warmth is **state, not GPU**: only
the **visible** pane holds a WebGL context, so many panes can't exhaust the browser's capped GPU contexts. List
navigation lives at the **window level** (arrows walk the list whatever holds focus), and **⌃/⌘+N** (or
**⌃/⌘+↑**/**Home**) snaps the selection to New Session from anywhere — even from the graph or while nav mode
forwards raw keys. The **header action row**
is the same board-command registry, narrowed to the current state: **nav** whenever live, **proof** + **merge**
at review/done — each a small **text** button (no glyphs) in its identity colour; an `offline` liveness
(any lifecycle) swaps them for a relaunch panel, and review is **agent-proposed** at the stop-gate. There is
**no header close/exit button** (neither has a button twin — a header "close" misreads as "close the panel"
while it discards the worktree): the destructive **close** (worktree removal) lives only on the row's
right-click menu, behind a confirm ([[session-rename]]); both verbs are otherwise reachable as the typed
`/exit`·`/close` commands above.
**Closing is event-driven**: the tab's *removal* — not any one gesture — drives where you
land. Still on the closed tab → New Session; already moved to another valid tab → your switch stands. The same
fallback covers a session that ends or is closed elsewhere, so the selection never points at a session the
board no longer has.

**SessionWindow** is the read-only glance, built from the shared **`SessionRow`** face — a two-row block
([[session-activity]]): Row 1 is the avatar (no status dot) + the session **headline** (the worker's live
tmux self-summary once it exists, else a launch-prompt placeholder; a rename always wins), with a 🔒 at its
end when the row is locked; Row 2 is the **colour-coded status word** + pending-op count. It stays a
**bounded** glance: the window never grows into a curtain — its height is capped (~80% of the viewport, and
always stopping short of the bottom **stats strip**), and a long session list **scrolls** inside it rather
than extending down over the board's stats bar. A single click **locks** the board onto
that session (overlays light, rest grey, focus jumps to its first changed node, see [[keyboard-nav]]); a
no-overlay session still locks un-greyed; a second click releases; **double-click opens** its board (mouse-side `⏎`). The **interface's own tabs** render the same `SessionRow` with those gestures **inverted**:
single click switches tab, double-click locks.

All surfaces share name and status from `session.js`, whose single **`STATUS_COLOR`** map paints **both** the
liveness dot **and** the status word the SAME hue everywhere they appear (window row, console tab + header,
@-mention and search rows, the relationship graph, the mobile card). Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
