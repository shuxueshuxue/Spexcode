---
title: session-console
status: active
hue: 280
desc: The Enter surface — a two-pane session interface whose console is a live tmux terminal or the shared TimelineChat conversation for a headless session.
code:
  - spec-dashboard/src/SessionInterface.jsx#SessionInterface
related:
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/session.js
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/harness.jsx
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/src/textarea.test.mjs
  - spec-dashboard/test/session-toolbar.e2e.mjs
  - spec-dashboard/test/session-command-preset.e2e.mjs
  - spec-dashboard/test/command-box.e2e.mjs
---

# session-console

## raw source

`Enter` on the board opens the session interface; the always-on top-left window (SessionWindow) is the
at-a-glance summary. Both are **thin views of `/api/graph`** (i.e. `spex graph --json`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

## expanded spec

The interface is a **routed page** (`#/sessions`, [[side-nav]]) — it fills the app's main area beside the
navigation rail as a peer of the graph, with no backdrop, no lift, no pop: Enter (from the graph) or the
global ⌥2 navigates to it, leaving it is likewise navigation (the rail, ⌥1/⌥3/⌥4, history — never Esc,
which stays inside the console's own stack), and its selected tab echoes into the URL (`#/sessions/<sel>`)
so a tab can be deep-linked. Selection validity is the real board session set, not only the currently
visible rows: a session hidden under a collapsed nesting parent can still be opened by URL, search, or an
originator chip, while ↑/↓ navigation continues to walk only the visible forest rows. Opening such a
hidden session from outside the list — including the graph's node menu — automatically unfolds every present
ancestor in the console's nesting forest, so the selected row is revealed instead of remaining hidden.
Leaving the page never unmounts it — pane-backed terminals keep their sockets and scroll warm, while the selected
terminal withdraws its [[live-view]] visibility claim until the shared pane opens again; a headless TimelineChat
keeps its timeline polling cursor and resumes from the latest board snapshot when selected again. Page display itself
belongs to the shell's shared pane boundary ([[side-nav]]), so the console renders only content and never
toggles its own display. The console **follows
the app theme**: its chrome — the session list, right frame, and Command Box — uses the same palette tokens as
the rest of the dashboard, so re-theming the app re-themes the console with it (no console-scoped palette
remap). The one surface that stays dark on its own is the **embedded terminal** (`--term-bg`) — legitimately a
dark terminal, whatever the app theme. Two panes: a left session list (its width user-draggable, [[resizable-panes]],
with a dense 204px default) and a right area that
**morphs** by what's focused. The list's **top button row** holds two compact pills above the session rows —
the `＋` New Session button and a **Search** button, the click twin of the ⌘/Ctrl+/ palette
([[session-search]] owns that contract) — kept out of the `↑/↓` path down to a session.

**New Session** is a centred splash — the [[launch-hero]] block-letter wordmark — over an auto-growing
input. Nothing is prefilled; typing **`[[`** opens the
node dropdown (the focused node leads it) — a topic reference ([[mentions]]). A **`/query` token at the
caret**, at the draft's start or after whitespace, opens the config-preset palette even when the draft already
contains prose; accepting it promotes the chosen `/<preset>` to the draft's start and preserves that prose.
The two compose the launch grammar `/<preset> [[node]]… <free text>`, from which the server derives the node
(the first `[[<id>]]`). Both menus only edit text; the New prompt has **no** `/` slash-command menu (presets
only). A preset launched with **no node target** never assumes a node — the agent takes scope from the prompt,
else asks first.
**Submitting launches but never switches tabs**: the prompt clears **immediately** and **focus stays in the box** —
the box **never disables or blurs**; the launch fires in the **background**, so the box is type-ready at once and you
can fire off several in a row **without waiting** for each launch's worktree+agent setup (seconds of real work) to
finish. Disabling the box for the whole in-flight window was the bug: on a slow or remote launch the entire pane sat
greyed and unfocused until the POST *and* a board re-read returned. You stay on New Session — the new session just
appears in the list below (the immediate board refresh, else the next poll, surfaces it). The old
auto-jump-to-the-new-session is gone; only a tab's *removal* (below) ever moves your selection for you.

Beneath the box a launcher **pop-out picker** is the ONLY launch choice ([[launcher-select]]). A
launcher names both the harness ([[harness-adapter]] — Claude vs Codex) and the command/auth profile, so the
launch `POST /api/sessions` carries only `launcher`; the backend derives `harness` from that selected profile.
The picker is a clean pill **button** wearing the selected launcher's harness vendor mark + name — no caret,
no label; its tooltip points at `spexcode.json` / `spexcode.local.json` as the one place launchers change.
It opens a **centred pop-out card** — a viewport-centred dialog over a light backdrop, deliberately
not an anchored dropdown — with **one row per dashboard-visible launcher** ([[launcher-visibility]]) (the row's
harness glyph + name, the selected row marked), and beneath each name the profile's configured command
**in full, as inert read-only text** (selectable for copying, but not a control — nothing in the card is
clickable except the row select itself; no chevron buttons, no edit surface: config files remain the
sole place a `cmd` is written). Selecting a row closes the pop;
a backdrop click or Esc closes it too. Seeded interactive launchers keep the picker present in an initialized
project, and configured dashboard-visible profiles add more names. The launcher pick is
**remembered** (per-browser), honors the backend's configured default when there is no remembered valid pick,
never assumes a node, and composes orthogonally with the `/<preset> [[node]]… text` grammar above.
The launch **substance** — that grammar's composition, the launcher fetch/default/remembered-pick, and the
one `POST /api/sessions` — is shared with the phone's composer ([[mobile-ui]]): both send the raw grammar
through `launch.js`, while [[launch]]'s backend owner performs the command-plugin invocation for every caller,
including CLI and direct API use. This tab owns only the desktop chrome around it (menus, focus discipline,
background fire) and never expands a plugin body itself.

An existing session's adapter chooses one real console surface. A pane-backed adapter shows its **live
interactive tmux terminal** (SessionTerm) — the agent's own TUI is the default input surface — but only when
its **liveness** ([[state]]) is live (`online`/`starting`). A headless adapter has no pane at any liveness;
its main console is the shared `TimelineChat` conversation over [[session-timeline]], readable after the process
goes offline. The optional [[message-stream]] full-process door is exposed only when the adapter's data capability
`messageStream` is true; the UI consumes that capability and never branches on a harness id. The terminal mount and the relaunch panel key on **liveness, never the lifecycle
label**: a session whose process is gone reads `offline` whatever its authored lifecycle (`asking`,
`review`, `error`, …), so it never mounts a tmux client against a dead id (which would leak tmux's bare
"no sessions" into the pane) — it shows the **relaunch panel** instead, offering to resume the same
conversation (the transcript and the session's global record survive — see [[runtime]]). `queued` is the one exception: it
has intentionally not launched, so it shows neither a terminal nor a relaunch, and self-starts as a slot
frees. The terminal pane is **flat**: it fills the right area directly — no inner bordered box, no title bar,
no nested levels, and no permanently reserved second-input strip. Its own prompt and status line reach the
pane's bottom edge. `Cmd/Alt+I` suspends [[command-box]] over the lower middle without resizing or reflowing
xterm; its fixed footer and upward growth belong to that temporary control surface. Above the pane, one
genuinely single-line **session toolbar**
contains only three things: the current surface, evaluation, and available commands. A pane-backed session exposes
its one **Terminal** tab; a headless session keeps TimelineChat as the main surface and may expose one
**full process** door when the adapter advertises `messageStream`. The door opens the native message stream as a
drill-down on both viewport classes; it is never a replacement console or an id-specific UI branch. Session identity, lifecycle,
and liveness do **not** repeat here: the selected row in the
left session list is the console's visible identity/state surface, so a second headline/status group only spends
height and injects volatile prompt/HTML text into `aria-label` / `data-tip`. The Eval entry is a **DOOR, not a tab** —
a REAL anchor whose href is
the canonical session-scoped Evals list address (the scoped default query, minted by [[address-routing]];
copy-link/middle-click work for free), and it sits outside the tablist, so clicking it (or the typed
`/eval`) is one ordinary hash push onto that list ([[session-eval]] /
[[evals-view]] — the one canonical home of a session's measured evaluation; the console mounts no
eval pane of its own, so the console width is stable and a warm pane is never reflowed;
see [[live-view]]). The door carries a compact, symbolic glance over that SAME worktree-rooted session model,
already bounded by [[session-eval]] to scenarios this worktree affected or measured. Its four mutually exclusive
scenario tallies are the complete visible accounting: reliable current pass/fail counts use [[review-chrome]]'s
`ReviewState` vocabulary, measured stale or legacy/unscored scenarios carry a visible clock tally as work still
needing review, and declared-but-unmeasured scenarios remain a visible blind-spot count. The door does NOT repeat
a measured/declared aggregate beside those categories: `fresh pass + fresh fail + needs review + blind = affected
declarations` already says the whole thing without a second number. Node-level unknown frontend coverage is a
separate missing-state tally, never part of the scenario accounting. The door's accessible name speaks this same
complete decomposition; the visible glance is never hidden from assistive technology. Loading, load failure, and zero are
distinct states — a transport failure is never painted as
zero loss. This is a glance and a door, never a scenario menu or an explanatory paragraph.
The glance is the selected graph session row's `evalSummary` projection; it performs no REST read and owns no
timer. Switching tabs or remounting therefore preserves the cached last-known value. An input event first shows
`updating` beside that last-known value, never zero; a stable equal-generation projection becomes current; a
compute failure stays explicit with last-known retained. A graph-stream disconnect similarly marks the value
last-known until an authoritative reconnect snapshot re-anchors it. `ready` with every category at zero is the
only empty state, distinct from loading, updating, disconnected, and error.

The toolbar wears the app-chrome background with a bottom separator, so it reads
**visibly apart from the console** below it in both light and dark themes (the old flat strip blended
into that dark edge — the complaint this replaces). Its exact height follows the real tab text, icon tools, and
focus rings rather than clipping them, targeting a compact ~32px instead of the former ~40px identity bar. At a
narrow pane the same one-line hierarchy progressively drops secondary Eval tallies while keeping the current surface, the
Eval door, and every currently available icon tool inside the pane. The bar never grows or
overflows for a long prompt/headline because no session headline enters it at all. Geometry stays stable across
all app themes, English/Chinese, lifecycle and liveness combinations, and Command Box visibility; a persisted wide session list
yields at the desktop/mobile boundary rather than crushing the terminal lane until toolbar controls clip.
The TUI owns keyboard input through xterm's native IME-aware path ([[terminal-input]]), while text still
selects and the wheel scrolls **the tmux pane's real history** — normal output through tmux copy-mode, mouse-owning TUIs by
forwarding the wheel to the app ([[live-view]] owns the adapter decision), with no browser-owned terminal
scrollbar competing with tmux — a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard **over HTTPS, localhost,
or plain HTTP** (past the secure-context-only Clipboard API). Selection changes highlight only: its first and
last cells remain legible, and moving an endpoint never shifts the terminal's glyph grid. The browser renderer
forwards keyboard data but no pointer reports, so it never enters the application's mouse-report modes;
the public terminal parser consumes those mode toggles at the adapter boundary. Pointer drag therefore remains
one uninterrupted local selection even when a TUI redundantly reasserts its mouse modes, while wheel navigation
continues through [[live-view]]'s explicit tmux-client control path.

The desktop right pane has **one console slot with two truthful transports**. A pane-backed adapter mounts the
warm, input-enabled `SessionTerm` described here. A headless adapter mounts the same `TimelineChat` used by the
phone, with no terminal placeholder and no tmux socket. Its optional full-process door delegates to
[[message-stream]] only when the adapter capability is present; native events remain an enhancement over the
timeline, not the main conversation. TimelineChat's composer always sends `replyVia:"note"`: this is the fixed
terminal-free surface property, and the note data arrives because the agent executes the external
`spex session <verb> --note` CLI; hooks only prompt the agent at turn boundaries and carry no note data.
Session rows still carry only their status and activity vocabulary — no redundant mode badge.

For a pane-backed console, input has **two explicit channels**. [[terminal-input]] is the default: xterm owns ordinary keys, paste, and
browser IME composition and sends its ordered data through the visible terminal WebSocket into the same native
tmux client that renders the agent's TUI. Re-selecting the active session or Terminal tab restores xterm focus
without first ending its composition. There is no dashboard type mode, general raw-key vocabulary, menu sniff,
or per-keystroke HTTP batching; the adapter's one modified-key bridge encodes Shift+Enter as `ESC CR`, matching
Codex and Claude inside true tmux.

Around both channels, **console chrome is pointer-inert for focus** (the panel-wide blanket;
[[terminal-input]] and [[focus-return]] carry the contract): pressing rows, zone headers, fold pods, the
resizer, pills, toolbar buttons, or the launcher pop acts without taking focus, so the current sink — TUI,
Command Box, or the New composer — keeps typing focus through any pointer work on the console, and a pop
that does take focus returns it on exit. Only the composers' own textareas, the rename input, and the xterm
screen take pointer focus.

[[command-box]] is the authored control channel, opened by its resident toolbar icon or the reserved single-
modifier `Cmd+I` / `Alt+I` chord. It floats in the lower middle, never reserves terminal layout, and uses
[[composer]]'s fixed footer with upward auto-growth. The draft belongs to the session and survives closing,
tab switches, and routing to Evals. Escape or an outside click closes it and returns focus to xterm; an
`Alt+Cmd+I` chord stays with the browser. An **Enter that commits an IME composition** belongs to the input and
never sends; plain Enter sends, while Shift+Enter adds a line.

Command Box dispatches through the **control socket** (never typed into the pane), so one prompt lands
atomically even in tmux copy-mode. Success clears the draft and closes; failure keeps both visible. A `/` line
may instead name a **board command**, intercepted client-side because sending that word to the agent cannot
operate the board. One registry (`sessionCommands.js`) feeds those rows and every toolbar twin, sharing action,
availability, identity colour, localized label, and icon. `/stop` stops the agent but keeps its resumable
worktree; `/close` removes the worktree; `/merge` merges; `/eval` opens the canonical session-scoped Evals page.
There is no `/type`. Board commands lead the menu tagged `[ui]` and run on acceptance; live command presets
tagged `[preset]` and harness commands follow as authoring rows that insert their token. Names deduplicate by
that precedence. `[[node]]` resolves at send to the node id plus its live `spec.md` pointer; `@session` and
`@new` reuse [[mentions]]. File paste, drop, and pick reuse [[file-attach]].

A **right-click on a session row** opens its context menu — **lock on graph**, rename or close
([[session-rename]]), select for bulk close ([[session-multi-select]]), and **attach** for a live row
([[attach-menu]], which hands over the `spex session attach <id>` command to join the session's real tmux) —
coexisting with the context-menu suppression. Lock on graph locks the board to that session and navigates to
`#/graph`; it has no pending-ops precondition, so an ops-less session still lands on the graph with the lock
banner explaining the empty grip. The shared `sessionName` puts a rename first in the label precedence.
The row order is **automatic** — the two-zone grouping below, newest-first within a zone — with no manual
drag-to-reorder gesture. Both authored composers accept an **attached file** (paste, drop, or the paperclip picker — a monochrome inline-SVG
glyph in the dashboard's own icon vocabulary, swapping to a spinning ring while uploading, **never a colour
emoji**), uploaded to the backend (= worker) `/tmp` with its path spliced in — see [[file-attach]].

Terminals are **warm and always connected**: every live pane mounts and opens its socket when the board loads —
never lazily on focus — and stays mounted even while the console is closed, so switching tabs **never loses your
place** (socket + last painted buffer survive), New Session included. Hidden layers remain laid out at the final
terminal geometry under `visibility:hidden`, keeping their xterm and stable default renderer ready; switching
changes visibility, not socket attachment or renderer identity. No pane loads a visibility-scoped WebGL addon,
so hidden sessions neither expose an empty replacement renderer nor accumulate capped GPU contexts. [[live-view]]
owns the matching backend rule: an unselected session, a closed Sessions route, or a background browser tab
owns no raw PTY or tmux geometry, while a visited hidden xterm keeps its cached pixels for an immediate return
paint. List navigation lives at the **window level** only when focus is outside xterm and every text input.
Plain **↑/↓** therefore walk the list from inert console chrome, while the live TUI and the New/Command Box
textareas keep their own arrows entirely. To switch sessions while typing or driving the TUI, use the modifier combos:
**⌘/⌥/⌃+↑/↓** are an **unconditional** switch — they step the selection up/down the list from anywhere, no
matter which input has focus (the guaranteed up/down switch a work console gives you). **⌥+N** reaching the New Session composer is no longer this console's own
chord — it belongs to [[side-nav]]'s app-global ⌥ command family (⌥N / ⌥F / ⌥1..⌥5), which the console's
key handling deliberately **falls through unhandled** so the window-level handler
routes it and tmux never sees `M-n`/`M-f`/`M-digit`. (The family is ⌥-based for the same hard browser limit
that shaped the old chord: **⌘+N/⌃+N are the browser's reserved new-window accelerator** whose keydown never
reaches the page to be cancelled — ⌥ is the modifier the app can actually own.) The **toolbar's command
group** renders the same board-command registry, narrowed to the current state: **Command Box** whenever live
and **merge** at review/done. Command Box is the resident tool and always sits at the group's right edge — it
is the one command present the whole time a session is live, so its position stays fixed while transient action
buttons (merge, and relaunch when offline) render to its **left** and never push it around; only the toolbar
render carries this anchoring. Every visible action uses one shared compact icon-toolbutton primitive and a familiar
[[icon-system]] / Lucide mark (command, git-merge, rotate/relaunch), with its registry identity colour;
there is no emoji, visible text label, or toolbar-local icon/action mapping. The registry remains the single row
that decides availability, colour, typed twin, localized tooltip/`aria-label`, pressed state, and execution.
Command Box exposes `aria-pressed` plus a stable selected treatment; an `offline` liveness (any lifecycle) swaps the
registry commands for the same primitive's relaunch action, and review is
**agent-proposed** at the stop-gate. **The evaluation is no longer one of these buttons** — it is the
permanent **Eval door**, always available for any selected session (see [[session-eval]]): the toolbar entry
or Command Box `/eval`, each navigating to the session-scoped Evals page. The reserved Command Box chord is
consumed but inert for offline/queued sessions, using the same registry judgment as the button. There is
**no close/exit button** here (neither has a button twin — a strip "close" misreads as "close the panel"
while it discards the worktree): the destructive **close** (worktree removal) lives only on the row's
right-click menu, behind a confirm ([[session-rename]]); both verbs are otherwise reachable as the typed
`/stop`·`/close` commands above.
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
no-overlay session still locks un-greyed; a second click releases; **double-click opens** its board (mouse-side `⏎`). The **interface's own tabs** render the same `SessionRow` with different gestures:
single click switches tab, while double-click has no separate meaning and therefore only leaves that tab
selected. Locking from the console is the row's explicit **right-click → lock on graph** action above, not a
hidden double-click gesture. The console renders the row in its **compact, avatar-less** variant
(`showAvatar={false} compact`): the console's own left list is a dense one-line-per-session list at rest, with
a 204px default width (15% below the former 240px) and caption-size row text; the selected headline may expand
in place to **at most three lines**, with its complete text retained in the tooltip/accessibility name. The
status is a single colour glyph, not a word. The avatar is dropped ONLY here — its cross-referencing job (matching a
session to the avatars on the nodes it edits) belongs to the map-side SessionWindow, which keeps it. The
list itself **groups into three triage zones** — *needs you* (asking / review / done / close-pending / error)
over *running* (working / parked / starting / queued …) over **offline** (dormant, at the bottom), a dim
header leading each — and within a zone the **newest** session sits on top. The **offline** zone is keyed on
**liveness, not the authored lifecycle**: a session whose process died while it was `asking`/`review`/`error`
keeps that pre-death lifecycle, yet it cannot act until relaunched, so it sorts to **offline** rather than
wrongly sitting under *needs you*; a merely booting session (`starting`/`queued`) stays under *running*. The
**offline zone rests folded behind its own header** — the ONE disclosure for session history. Retired and
dormant sessions accumulate (an adopter's CR record sessions are deliberately kept alive for their external
deep links), and a list that renders every one of them drowns the two zones a human acts on; but they are
records, so they are never deleted and never more than one click away. The zone header carries the hidden
COUNT and an expanded/collapsed affordance (`aria-expanded` speaks it); clicking toggles — pointer-inert for
focus like every zone header. Folding is **presentation only** (per-surface state, collapsed again on a
fresh mount; no session record is touched), it applies to **no other zone** — *needs you* and *running* rows
can never be hidden by any fold — and the **selected session stays revealed**: a row chosen by URL,
search, an originator chip, or the graph's node menu renders even while its zone is folded, so a deep link
into history always lands on its visible row. ↑/↓ walk only the visible rows, as with every fold. The
selected row is marked by the **highlight wash alone**, no caret. Both list surfaces share this grouping +
compact one-line layout; only the avatar differs (the map-side window keeps it, the console list drops it).

All surfaces share name and status from `session.js`, whose single **`STATUS_COLOR`** map paints the
liveness dot, the status word, **and** the compact sidebar's status **glyph** (`STATUS_GLYPH`) the SAME hue
everywhere they appear (window row, console sidebar row, @-mention and search rows, the mobile card).
The toolbar deliberately carries none of these identity/status marks. Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
