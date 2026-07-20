---
title: session-console
status: active
hue: 280
desc: The Enter surface — two-pane session interface with a live tmux terminal.
code:
  - spec-dashboard/src/SessionInterface.jsx#SessionInterface
  - spec-dashboard/src/SessionInterface.jsx#composingKey
  - spec-dashboard/src/SessionInterface.jsx#typeKeyToken
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
Leaving the page never unmounts it — the terminals keep their sockets and scroll warm; page visibility
itself belongs to the shell's shared pane boundary ([[side-nav]]), so the console renders only content and
never toggles its own display. The console **follows
the app theme**: its chrome — the session list, the right frame, the docked input — uses the same palette tokens as
the rest of the dashboard, so re-theming the app re-themes the console with it (no console-scoped palette
remap). The one surface that stays dark on its own is the **embedded terminal** (`--term-bg`) — legitimately a
dark terminal, whatever the app theme. Two panes: a left session list (its width user-draggable, [[resizable-panes]]) and a right area that
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
not an anchored dropdown — with **one row per launcher** (the row's
harness glyph + name, the selected row marked), and beneath each name the profile's configured command
**in full, as inert read-only text** (selectable for copying, but not a control — nothing in the card is
clickable except the row select itself; no chevron buttons, no edit surface: config files remain the
sole place a `cmd` is written). Selecting a row closes the pop;
a backdrop click or Esc closes it too. Built-in `claude` and `codex` launchers keep the picker present even in a
zero-config project, and configured profiles add more names. The launcher pick is
**remembered** (per-browser), honors the backend's configured default when there is no remembered valid pick,
never assumes a node, and composes orthogonally with the `/<preset> [[node]]… text` grammar above.
The launch **substance** — that grammar's composition, the launcher fetch/default/remembered-pick, and the
one `POST /api/sessions` — is shared with the phone's composer ([[mobile-ui]]): both send the raw grammar
through `launch.js`, while [[launch]]'s backend owner performs the command-plugin invocation for every caller,
including CLI and direct API use. This tab owns only the desktop chrome around it (menus, focus discipline,
background fire) and never expands a plugin body itself.

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
At rest the single-line `❯` box occupies that strip **exactly** — the `❯` and its line sit **vertically
centred** in the strip (equal space above and below), never sunk toward its bottom edge — and the terminal
**ends above it** (the resting input reserves real layout height, so the terminal does not stretch under
it) — the terminal's own bottom status line is therefore never hidden. Only when the box grows multi-line
does it **overlay** the terminal, expanding
**upward** over its lower edge; growth never pushes the terminal's content up (only the resting single line
reserves space — growth overlays). The input's panel fill stays inside its visible top boundary in both the
resting and grown states; it never paints through that separator into the terminal. Growth is
**content-driven**: only real draft content grows the box —
an EMPTY box always rests at its single line, its placeholder clipping rather than wrapping the "resting"
strip taller than the space the terminal reserved. Above the pane, one genuinely single-line **session toolbar**
contains only three things: the current surface, evaluation, and available commands. Its surface group contains
**Terminal as the sole real tab** (`role=tab` in the only `tablist`) and keeps that selected surface visually
attached to the live pane. Session identity, lifecycle, and liveness do **not** repeat here: the selected row in the
left session list is the console's visible identity/state surface, so a second headline/status group only spends
height and injects volatile prompt/HTML text into `aria-label` / `data-tip`. The Eval entry is a **DOOR, not a tab** —
a REAL anchor whose href is
the canonical session-scoped Evals list address (the scoped default query, minted by [[address-routing]];
copy-link/middle-click work for free), and it sits outside the tablist, so clicking it (or the typed
`/eval`) is one ordinary hash push onto that list ([[session-eval]] /
[[evals-view]] — the one canonical home of a session's measured evaluation; the console mounts no
eval pane of its own, so the terminal's width is stable and the warm pane is never reflowed;
see [[live-view]]). The door carries a compact, symbolic glance over that SAME worktree-rooted session model,
already bounded by [[session-eval]] to scenarios this worktree affected or measured: measured scenarios over
in-scope declared scenarios is always explicit (including `0/0`); reliable current pass/fail
counts use [[review-chrome]]'s `ReviewState` vocabulary, measured stale or legacy/unscored scenarios carry a
visible clock tally as work still needing review, and declared-but-unmeasured scenarios remain a visible
blind-spot count. These mutually exclusive tallies explain the whole scenario fraction at a glance:
`fresh pass + fresh fail + needs review + blind = affected declarations`. Node-level unknown frontend coverage
is a separate missing-state tally, never part of the scenario fraction. Loading, load failure, and zero are
distinct states — a transport failure is never painted as
zero loss. This is a glance and a door, never a scenario menu or an explanatory paragraph.
While this toolbar is visible, the glance refreshes on a bounded cadence as well as session/page edges, so a
reading filed during a long `working` stretch becomes visible without forcing a tab switch or lifecycle change.

The toolbar wears the app-chrome background with a bottom separator, so it reads
**visibly apart from the dark terminal** below it in both light and dark themes (the old flat strip blended
into that dark edge — the complaint this replaces). Its exact height follows the real tab text, icon tools, and
focus rings rather than clipping them, targeting a compact ~32px instead of the former ~40px identity bar. At a
narrow pane the same one-line hierarchy progressively drops secondary Eval tallies while keeping Terminal, the
measured/declared Eval count, and every currently available icon tool inside the pane. The bar never grows or
overflows for a long prompt/headline because no session headline enters it at all. Geometry stays stable across
all app themes, English/Chinese, lifecycle and liveness combinations, and type mode; a persisted wide session list
yields at the desktop/mobile boundary rather than crushing the terminal lane until toolbar controls clip.
Read-only governs *keyboard* input, not extraction or navigation: text selects, and the
wheel scrolls **the tmux pane's real history** — normal output through tmux copy-mode, mouse-owning TUIs by
forwarding the wheel to the app ([[live-view]] owns the adapter decision), with no browser-owned terminal
scrollbar competing with tmux — a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard **over HTTPS, localhost,
or plain HTTP** (past the secure-context-only Clipboard API).

The desktop right pane has **one session shape**: every launched session is an ordinary interactive session,
so its first tab is Terminal and mounts the warm `SessionTerm` + `❯` input described here. Launchers choose a
harness and command/auth profile; they do not change the desktop session shape, hide the terminal behind a
capability placeholder, or replace it with a timeline chat. The phone's terminal-free conversation is a
property of that viewport's surface ([[mobile-ui]]), not durable session identity. Session rows therefore
carry only their status and activity vocabulary — no mode mark or other launch-axis badge.

Input has **two channels**. The **`❯` box** is the prompt channel: submitting dispatches through the **control
socket** (never typed into the pane), so it lands even in copy-mode. An **Enter that commits an IME
composition** (pinyin/かな/한글 — the browser flags it `isComposing` / legacy keyCode 229) belongs to the
input: it picks the candidate and composes the word, and is **never** read as dispatch — the same guard covers
the running session's send, the New Session launch Enter, and a completion menu's Enter/Tab accept, so choosing
a candidate never fires the line. Only a plain Enter that ends no composition sends. The exception is the **board commands** —
a `/` line the box intercepts client-side and runs HERE instead of sending to the agent (where the word would
only drive the agent's own process, not the board). They come from **one registry** (`sessionCommands.js`) that
feeds both the typed rows and every available toolbar tool; where a command has a visible twin, they share one
action and one **identity colour**, never two codepaths. The two terminal verbs split by what they destroy:
**`/stop`** stops this
session (`act('stop')`, **muted grey** — v0.3.0 respelled it off the old `/exit`, which collided with Claude
Code's own `/exit` and now passes through as CC's) — it kills the agent + tmux but **keeps the worktree**, so
the session goes `offline` and offers **relaunch** (the same resumable stop a crash produces, see [[state]]);
**`/close`** removes it (`act('close')`, **red**) — worktree + branch gone, the work discarded, the row's
right-click Close's twin. `/merge` merges (green), `/type` toggles type mode (yellow), `/eval` opens the
**session-scoped Evals page** (cyan — the same door as the bar's Eval entry). In the inbox `/` menu they **lead** the list, coloured, tagged `[ui]`, apart from CC's
blue command rows; accepting one **runs** it (the one row that acts, not inserts — see [[term-input]]). A
board command still **overrides** a same-named CC command so a name shows **once** — though after the
`/exit`→`/stop` respelling no board name currently twins a CC one: one command, one identity. Row
descriptions render as sentences (first letter capitalised). Typed `/stop` and `/close` carry **no
confirm** — typing the exact command is itself the deliberate act, where the row-menu's Close guards an
easy-to-mis-aim right-click. The box **holds
focus persistently** — clicking
chrome never blurs it, the panel **suppresses the native context menu** and **restores** focus after a
right-click. Focus retention blankets the **inert** chrome only: it blocks the blur by cancelling the
mousedown's default over dead space, but **never over a native form control** (`<select>`, an `<option>`)
that owns its own mousedown — a native `<select>` *opens* on that default action, so cancelling it would
leave the control dead to the pointer. (No such control currently renders in the panel — the launcher
picker ([[launcher-select]]) is a button pop-out, whose clicks fire fine under the blanket — but the
carve-out stays as the rule any future native control relies on.) It **auto-grows upward**, **capped at half** the terminal height, and the grown size **survives a
round-trip through type mode** — the box unmounts while type mode replaces it, but its height is derived from
the per-session draft (which persists), so on return it re-fits instead of collapsing to one line. Taking the
Eval door routes away without unmounting the warm console, preserving the same draft and pane geometry. It
carries the same **completion** menus
the New prompt does ([[term-input]]): the inbox `/` lists the board+CC commands, and `[[` opens the spec-node
dropdown — one menu shared with New, not a second copy. A `[[node]]` here **resolves at send**, expanding to
a pointer at the node's live `spec.md` so the running agent is aimed at that contract. The second channel is **type mode** — the human-takeover channel, named for
what the user reaches for ("I want to type into the terminal myself") — entered by the `/type` board command, the header
button, or the reserved `⌥/⌘+I`: the `❯` box disables and **every keystroke — `⌃`/`⌥`/`⌘` combos included —
forwards raw** to the pane, so a human drives the agent's terminal, not just its arrows. Those **reserved
`⌥/⌘+I`** keys toggle type mode and are **never forwarded to tmux nor overridable by the app**; entry is
otherwise **manual**, and leaving the tab or going offline exits. **`Esc` is not an exit** — it always
forwards to the pane like any other key, because Esc belongs to the agent's own menus and dialogs; a human
cancelling something *in* the terminal must never be bounced out of the mode mid-gesture (the old
double-Esc-within-600ms escape hatch is gone for exactly that reason). The reserved chord is a **single**
modifier + I — `⌥+I` *or* `⌘+I`, never both: **`⌥⌘I` held together is the browser's own devtools accelerator**,
so the app lets that three-key combo pass straight through to open the console rather than swallowing it as a
type-mode toggle. A best-effort pane sniff — a
select-caret line beside an `Esc`/Enter hint line — only ever **suggests** type mode by pulsing the type
button, a non-authoritative nudge that never seizes keys.

A **right-click on a session row** opens its context menu — **lock on graph**, rename or close
([[session-rename]]), select for bulk close ([[session-multi-select]]), and **attach** for a live row
([[attach-menu]], which hands over the `spex session attach <id>` command to join the session's real tmux) —
coexisting with the context-menu suppression. Lock on graph locks the board to that session and navigates to
`#/graph`; it has no pending-ops precondition, so an ops-less session still lands on the graph with the lock
banner explaining the empty grip. The shared `sessionName` puts a rename first in the label precedence.
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
reaches the page to be cancelled — ⌥ is the modifier the app can actually own.) The **toolbar's command
group** renders the same board-command registry, narrowed to the current state: **type** whenever live and
**merge** at review/done. Every visible action uses one shared compact icon-toolbutton primitive and a familiar
[[icon-system]] / Lucide mark (keyboard/type, git-merge, rotate/relaunch), with its registry identity colour;
there is no emoji, visible text label, or toolbar-local icon/action mapping. The registry remains the single row
that decides availability, colour, typed twin, localized tooltip/`aria-label`, pressed state, and execution.
Type exposes `aria-pressed` plus a stable selected treatment; an `offline` liveness (any lifecycle) swaps the
registry commands for the same primitive's relaunch action, and review is
**agent-proposed** at the stop-gate. **The evaluation is no longer one of these buttons** — it is the
permanent **Eval door**, always available for any selected session (see [[session-eval]]): the toolbar entry
or the typed `/eval`, each navigating to the session-scoped Evals page. There is
no hidden keyboard escape from this availability: the reserved type-mode chord remains consumed but inert for
offline/queued sessions, using the same registry judgment as the button and `/type` twin. There is
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
everywhere they appear (window row, console sidebar row, @-mention and search rows, the mobile card).
The toolbar deliberately carries none of these identity/status marks. Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
