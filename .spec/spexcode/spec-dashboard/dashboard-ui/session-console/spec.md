---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx
related:
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/session.js
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/harness.jsx
---

# session-console

## raw source

`Enter` on the board opens the session interface; the always-on top-left window (SessionWindow) is the
at-a-glance summary. Both are **thin views of `/api/board`** (i.e. `spex board`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

## expanded spec

The interface is a **routed page** (`#/sessions`, [[side-nav]]) — it fills the app's main area beside the
navigation rail as a peer of the graph, with no backdrop, no lift, no pop: Enter (from the graph) or the
global ⌥2 navigates to it, leaving it is likewise navigation (the rail, ⌥1/⌥3/⌥4, history — never Esc,
which stays inside the console's own stack), and its selected tab echoes into the URL (`#/sessions/<sel>`)
so a tab can be deep-linked. Selection validity is the real board session set, not only the currently
visible rows: a session hidden under a collapsed nesting parent can still be opened by URL, search, or an
originator chip, while ↑/↓ navigation continues to walk only the visible forest rows.
Leaving the page never unmounts it — the terminals keep their sockets and scroll warm. The console **follows
the app theme**: its chrome — the session list, the right frame, the docked input — uses the same palette tokens as
the rest of the dashboard, so re-theming the app re-themes the console with it (no console-scoped palette
remap). The one surface that stays dark on its own is the **embedded terminal** (`--term-bg`) — legitimately a
dark terminal, whatever the app theme. Two panes: a left session list (its width user-draggable, [[resizable-panes]]) and a right area that
**morphs** by what's focused. The list's **top button row** holds two compact pills above the session rows —
the `＋` New Session button and a **Search** button, the click twin of the ⌘/Ctrl+/ palette
([[session-board-search]] owns that contract) — kept out of the `↑/↓` path down to a session.

**New Session** is a centred avatar + auto-growing input. Nothing is prefilled; typing **`[[`** opens the
node dropdown (the focused node leads it) — a topic reference ([[mentions]]). A leading **`/`** opens the
config-preset palette; the two compose the launch grammar `/<preset> [[node]]… <free text>`, from which the
server derives the node (the first `[[<id>]]`). Both menus only insert text; the New prompt has **no** `/`
slash-command menu (presets only). A preset launched with **no node target** never assumes a node — the agent
takes scope from the prompt, else asks first.
**Submitting launches but never switches tabs**: the prompt clears **immediately** and **focus stays in the box** —
the box **never disables or blurs**; the launch fires in the **background**, so the box is type-ready at once and you
can fire off several in a row **without waiting** for each launch's worktree+agent setup (seconds of real work) to
finish. Disabling the box for the whole in-flight window was the bug: on a slow or remote launch the entire pane sat
greyed and unfocused until the POST *and* a board re-read returned. You stay on New Session — the new session just
appears in the list below (the immediate board refresh, else the next poll, surfaces it). The old
auto-jump-to-the-new-session is gone; only a tab's *removal* (below) ever moves your selection for you.

Beneath the box a native launcher-**name** `<select>` is the ONLY launch choice ([[launcher-select]]). A
launcher names both the harness ([[harness-adapter]] — Claude vs Codex) and the command/auth profile, so the
launch `POST /api/sessions` carries only `launcher`; the backend derives `harness` from that selected profile.
Built-in `claude` and `codex` launchers keep the select present even in a zero-config project, and configured
profiles add more names. The selected launcher's harness reads as a derived **icon** beside the select: the
vendor glyph updates as the selection changes, but it is an adornment, not a second input. The launcher pick is
**remembered** (per-browser), honors the backend's configured default when there is no remembered valid pick,
never assumes a node, and composes orthogonally with the `/<preset> [[node]]… text` grammar above.

An existing session shows its **live tmux terminal** (SessionTerm) with the docked **`❯` input** below — a
**real tmux client but a read-only scrollable view** — but only when its **liveness** ([[state]]) is live
(`online`/`starting`). The terminal mount and the relaunch panel key on **liveness, never the lifecycle
label**: a session whose process is gone reads `offline` whatever its authored lifecycle (`asking`,
`review`, `error`, …), so it never mounts a tmux client against a dead id (which would leak tmux's bare
"no sessions" into the pane) — it shows the **relaunch panel** instead, offering to resume the same
conversation (the transcript and the session's global record survive — see [[runtime]]). `queued` is the one exception: it
has intentionally not launched, so it shows neither a terminal nor a relaunch, and self-starts as a slot
frees. The terminal pane is **flat**: it fills the right area directly — no inner bordered box, no title bar,
no nested levels — the dark terminal edge-to-edge above a **fixed input strip reserved at the pane's bottom**.
At rest the single-line `❯` box occupies that strip and the terminal **ends above it** (the resting input
reserves real layout height, so the terminal does not stretch under it) — the terminal's own bottom status
line is therefore never hidden. Only when the box grows multi-line does it **overlay** the terminal, expanding
**upward** over its lower edge; growth never pushes the terminal's content up (only the resting single line
reserves space — growth overlays). Above the pane a **horizontal tab bar** replaces the old title/action
strip, carrying **two tabs on the left** — **Terminal** (the default) and **Eval**: Terminal shows the live
pane with the docked `❯` input; Eval shows this session's measured evaluation **inline** (an always-available
view — the shared eval components, session-scoped; below and [[review-proof]]). **Opening the Eval tab
auto-collapses the left session list to a thin strip** — the same fold-to-strip geometry the Evals page's
master list uses ([[evals-view]]), and for the same reason: the Eval tab is itself a master-detail whose own
scenario list ([[review-proof]]) needs room, so leaving the console's full-width session list beside it would
crowd two lists into the width one deserves. The collapse is **automatic on entering the tab and reverts on
returning to Terminal**; the strip is the unfold affordance (click to bring the list back, which then stays
until you leave the tab), and the list stays **mounted** behind it — the fold is pure geometry, so its zone
grouping, nesting-fold, and selection survive untouched. The fold shows **only while Eval is the tab**, so the
terminal's width is **stable across a Terminal↔Eval round-trip** — the warm pane is never reflowed on the way
back (a reflow would scroll a normal-screen codex pane back through its history; see [[live-view]]). The bar wears the app-chrome background with a bottom separator, so it reads
**visibly apart from the dark terminal** below it in both light and dark themes (the old flat strip blended
into that dark edge — the complaint this replaces). Between the tabs and the actions it still carries the
**shared session headline** (`si-th-name`, [[session-activity]]) — same source and content as the session
rows, ellipsing when tight, so it never disagrees with the row that opened it — and the state's lifecycle
**actions on the right** (below). Read-only governs *keyboard* input, not extraction or navigation: text selects, and the
wheel scrolls **the tmux pane's real history** — normal output through tmux copy-mode, mouse-owning TUIs by
forwarding the wheel to the app ([[live-view]] owns the adapter decision), with no browser-owned terminal
scrollbar competing with tmux — a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard **over HTTPS, localhost,
or plain HTTP** (past the secure-context-only Clipboard API).

Input has **two channels**. The **`❯` box** is the prompt channel: submitting dispatches through the **control
socket** (never typed into the pane), so it lands even in copy-mode. The exception is the **board commands** —
a `/` line the box intercepts client-side and runs HERE instead of sending to the agent (where the word would
only drive the agent's own process, not the board). They come from **one registry** (`sessionCommands.js`) that
ALSO renders the header buttons, so each command is the **typed twin of a button** — one action, one **identity
colour**, never two codepaths. The two terminal verbs split by what they destroy: **`/exit`** stops this
session (`act('exit')`, **muted grey**) — it kills the agent + tmux but **keeps the worktree**, so the session
goes `offline` and offers **relaunch** (the same resumable stop a crash produces, see [[state]]); **`/close`**
removes it (`act('close')`, **red**) — worktree + branch gone, the work discarded, the row's right-click Close's
twin. `/merge` merges (green), `/type` toggles type mode (yellow), `/eval` jumps to the **Eval tab** (cyan). In the inbox
`/` menu they **lead** the list, coloured, tagged `[board]`, apart from CC's blue command rows; accepting one
**runs** it (the one row that acts, not inserts — see [[term-input]]). A board command **overrides** a
same-named CC command (CC ships its own `/exit`), so that name shows **once** — as the board's, never a
duplicate row: one command, one identity. Row descriptions render as sentences (first letter capitalised).
Typed `/exit` and `/close` carry **no
confirm** — typing the exact command is itself the deliberate act, where the row-menu's Close guards an
easy-to-mis-aim right-click. The box **holds
focus persistently** — clicking
chrome never blurs it, the panel **suppresses the native context menu** and **restores** focus after a
right-click. Focus retention blankets the **inert** chrome only: it blocks the blur by cancelling the
mousedown's default over dead space, but **never over a native form control** (`<select>`, an `<option>`)
that owns its own mousedown — a native `<select>` *opens* on that default action, so cancelling it would
leave the control dead to the pointer. The launcher picker ([[launcher-select]]) is such a control; keeping
the input focused must not cost the picker its click, so the two concerns coexist — focus stays, and the
native dropdown still opens. It **auto-grows upward**, **capped at half** the terminal height, and the grown size **survives a
round-trip away from the Terminal tab** — the box unmounts while Eval or type mode replaces it, but its height is
derived from the per-session draft (which persists), so on return it re-fits to that draft instead of collapsing
back to one line. It carries the same **completion** menus
the New prompt does ([[term-input]]): the inbox `/` lists the board+CC commands, and `[[` opens the spec-node
dropdown — one menu shared with New, not a second copy. A `[[node]]` here **resolves at send**, expanding to
a pointer at the node's live `spec.md` so the running agent is aimed at that contract. The second channel is **type mode** — the human-takeover channel, named for
what the user reaches for ("I want to type into the terminal myself") — entered by the `/type` board command, the header
button, or the reserved `⌥/⌘+I`: the `❯` box disables and **every keystroke — `⌃`/`⌥`/`⌘` combos included —
forwards raw** to the pane, so a human drives the agent's terminal, not just its arrows. Those **reserved
`⌥/⌘+I`** keys toggle type mode and are **never forwarded to tmux nor overridable by the app**; entry is
otherwise **manual**, and leaving the tab or going offline exits — as does a **second `Esc` within 600 ms**
(the first `Esc` still forwards to the pane to cancel the agent's own menu). The reserved chord is a **single**
modifier + I — `⌥+I` *or* `⌘+I`, never both: **`⌥⌘I` held together is the browser's own devtools accelerator**,
so the app lets that three-key combo pass straight through to open the console rather than swallowing it as a
type-mode toggle. A best-effort pane sniff — a
select-caret line beside an `Esc`/Enter hint line — only ever **suggests** type mode by pulsing the type
button, a non-authoritative nudge that never seizes keys.

A **right-click on a session row** opens its context menu — rename or close ([[session-rename]]) — coexisting
with the context-menu suppression; the shared `sessionName` puts that rename first in the label precedence.
The row order is **automatic** — the two-zone grouping below, newest-first within a zone — with no manual
drag-to-reorder gesture. Either input also accepts an **attached file** (paste, drop, or the paperclip picker — a monochrome inline-SVG
glyph in the dashboard's own icon vocabulary, swapping to a spinning ring while uploading, **never a colour
emoji**), uploaded to the backend (= worker) `/tmp` with its path spliced in — see [[file-attach]].

Terminals are **warm and always connected**: every live pane mounts and opens its socket when the board loads —
never lazily on focus — and stays mounted even while the console is closed, so switching tabs **never loses your
place** (socket + scroll survive), New Session included (it hides its pane). Warmth is **state, not GPU**: only
the **visible** pane holds a WebGL context, so many panes can't exhaust the browser's capped GPU contexts. List
navigation lives at the **window level**: plain **↑/↓** walk the list, but a **text input keeps them
entirely** — inside the New prompt or the `❯` box, ↑/↓ are always the textarea's own caret keys and **never
switch tabs**, even at the first/last line, so typing in the box never jerks you onto another session (the box
stays stable; the old visual-edge fall-through to the list is gone). Plain ↑/↓ still walk the list only when
focus is **outside** any text input. To switch tabs while typing, use the modifier combos:
**⌘/⌥/⌃+↑/↓** are an **unconditional** switch — they step the selection up/down the list from anywhere, no
matter which input has focus or what mode you're in (the guaranteed up/down switch a chat app gives you), even
while type mode forwards raw keys. **⌥+N** reaching the New Session composer is no longer this console's own
chord — it belongs to [[side-nav]]'s app-global ⌥ command family (⌥N / ⌥F / ⌥1..⌥5), which the console's
key handling deliberately **falls through unhandled** — type mode included — so the window-level handler
routes it and tmux never sees `M-n`/`M-f`/`M-digit`. (The family is ⌥-based for the same hard browser limit
that shaped the old chord: **⌘+N/⌃+N are the browser's reserved new-window accelerator** whose keydown never
reaches the page to be cancelled — ⌥ is the modifier the app can actually own.) The **tab bar's
right side** holds the same board-command registry as action buttons, narrowed to the current state:
**type** whenever live and **merge** at review/done — each a small **text** button (no glyphs) in its
identity colour; an `offline` liveness (any lifecycle) swaps them for a relaunch button, and review is
**agent-proposed** at the stop-gate. **The evaluation is no longer one of these buttons** — it is a
permanent **Eval tab**, always available for any selected session (see [[review-proof]]), reached by
clicking the tab or the typed `/eval`. There is
**no close/exit button** here (neither has a button twin — a strip "close" misreads as "close the panel"
while it discards the worktree): the destructive **close** (worktree removal) lives only on the row's
right-click menu, behind a confirm ([[session-rename]]); both verbs are otherwise reachable as the typed
`/exit`·`/close` commands above.
**Closing is event-driven**: the tab's *removal* — not any one gesture — drives where you
land. Still on the closed tab → New Session; already moved to another valid tab → your switch stands. The same
fallback covers a session that ends or is closed elsewhere, so the selection never points at a session the
board no longer has.

**SessionWindow** is the read-only glance, built from the shared **`SessionRow`** face
([[session-activity]]) in the SAME **compact one-line, zone-grouped** layout as the console list — but
KEEPING the **avatar** (its cross-referencing job) and the board's warm paper: the avatar + the session
**headline** (the worker's live tmux self-summary once it exists, else a launch-prompt placeholder; a rename
always wins) + a single colour-coded status **glyph** + pending-op count; the session's `launcher` remains
durable data on the API payload but is not rendered as a per-row badge, keeping the glance clean. On one line,
with a **monochrome
inline-SVG padlock** (the dashboard's own glyph vocabulary, not a colour emoji) at the headline's end when the
row is locked. It stays a
**bounded** glance: the window never grows into a curtain — its height is capped (~80% of the viewport, and
always stopping short of the bottom **stats strip**), and a long session list **scrolls** inside it rather
than extending down over the board's stats bar. A single click **locks** the board onto
that session (overlays light, rest grey, focus jumps to its first changed node, see [[keyboard-nav]]); a
no-overlay session still locks un-greyed; a second click releases; **double-click opens** its board (mouse-side `⏎`). The **interface's own tabs** render the same `SessionRow` with those gestures **inverted**:
single click switches tab, double-click locks **and returns to the graph** (the console is a routed page,
so the lock is only visible back on the board) — with **no pending-ops precondition**: an ops-less session
still locks, the banner explaining the empty grip, exactly like the window's single-click; a silent no-op
here is the bug, not the contract — but in its **compact, avatar-less** variant
(`showAvatar={false} compact`): the console's own left list is a dense one-line-per-session list, the status a
single colour glyph not a word. The avatar is dropped ONLY here — its cross-referencing job (matching a
session to the avatars on the nodes it edits) belongs to the map-side SessionWindow, which keeps it. The
list itself **groups into three triage zones** — *needs you* (asking / review / done / close-pending / error)
over *running* (working / parked / starting / queued …) over **offline** (dormant, at the bottom), a dim
header leading each — and within a zone the **newest** session sits on top. The **offline** zone is keyed on
**liveness, not the authored lifecycle**: a session whose process died while it was `asking`/`review`/`error`
keeps that pre-death lifecycle, yet it cannot act until relaunched, so it sorts to **offline** rather than
wrongly sitting under *needs you*; a merely booting session (`starting`/`queued`) stays under *running*. The
selected row is marked by the **highlight wash alone**, no caret. Both list surfaces share this grouping +
compact one-line layout; only the avatar differs (the map-side window keeps it, the console list drops it).

All surfaces share name and status from `session.js`, whose single **`STATUS_COLOR`** map paints the
liveness dot, the status word, **and** the compact sidebar's status **glyph** (`STATUS_GLYPH`) the SAME hue
everywhere they appear (window row, console tab + header, @-mention and search rows,
the mobile card). Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
