---
title: session-console
status: active
hue: 280
desc: The Enter surface — a two-pane session interface whose console is a live tmux terminal or the shared TimelineChat Conversation, selected locally for a pane-backed session and fixed for a headless one.
code:
  - spec-dashboard/src/SessionInterface.jsx#SessionInterface
related:
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/session.js
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/sessionSurface.js
  - spec-dashboard/src/harness.jsx
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/src/textarea.test.mjs
  - spec-dashboard/test/session-toolbar.e2e.mjs
  - spec-dashboard/test/session-web.e2e.mjs
  - spec-dashboard/test/session-command-preset.e2e.mjs
  - spec-dashboard/test/session-tree-disclosure.e2e.mjs
  - spec-dashboard/test/session-sidebar-scroll.e2e.mjs
  - spec-dashboard/test/command-box.e2e.mjs
  - spec-dashboard/test/lifecycle-outcome.e2e.mjs
  - spec-dashboard/test/timeline-chat-composer.e2e.mjs
  - spec-dashboard/test/session-surface-cold-readable.e2e.mjs
  - spec-dashboard/test/session-archive-zone.e2e.mjs
---

# session-console

## raw source

`Enter` on the board opens the session interface; the finding dock's session projection is the
at-a-glance summary. Both are **thin views of `/api/graph`** (i.e. `spex graph --json`): the dashboard renders only
what the backend reports and never invents session state, so a human watching the dashboard and an agent
driving the same sessions through the CLI see identical state.

A persisted session **rename** is a graph-stream action, not a private action-refetch: after the route commits
the name and nudges the sessions domain, the visible row advances from the delta stream. A
concurrent structural full may continue in the background, but the newest session projection reaches the console
first and structural convergence must not replace it with an older row. The rename surface may recover a failed
write, but a successful rename does not hide the push path behind a second `/api/graph` request. Archive and
close retain their own action/recovery contracts.

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
keeps its rendered timeline cursor, polls only while selected, and resumes from the latest board snapshot when selected again. Open resource tabs follow
the same display-hidden lifetime: changing tab, session, or route never unmounts their preview or frame. Page display itself
belongs to the shell's shared pane boundary ([[side-nav]]), so the console renders only content and never
toggles its own display. The console **follows
the app theme**: its chrome — the session list, right frame, and Command Box — uses the same palette tokens as
the rest of the dashboard, so re-theming the app re-themes the console with it (no console-scoped palette
remap). The one surface that stays dark on its own is the **embedded terminal** (`--term-bg`) — legitimately a
dark terminal, whatever the app theme. The document has one right area that
**morphs** by what's focused. Search remains available through the shell palette and the existing ⌥+/ binding;
the sessions dock owns the list's `＋` New Session door. The document is bounded by the routed page's viewport
and owns the terminal/timeline surface without a second navigation scrollbar.

The archive is a fourth session **zone**, after needs-you, running, and offline. Its heading remains visible even
when `N` is zero and carries the complete count of closed records. Like offline, its whole header is one keyboard-
reachable disclosure button; the count chip is a visual marker inside it, not a separate target. The console's
panel-level inert chrome press keeps pointer activation from stealing the current input sink. The zone is folded by
default with its fold choice persisted locally. When open it shows the newest
closed rows (bounded to a small fixed number so it cannot drown the working list), then one `View all N` row. The
closed rows are ordinary session rows with the same hover and selected treatment; selecting one opens its read-only
Conversation. `View all N` is a keyboard-reachable button that follows the same row geometry, ink, bottom rule, and
hover wash as a session row, with the shared search glyph in the nesting-lead column; it has no selected state. Dropping
a working row on the visible archive heading performs the one reversible close transition without confirmation.
While a drag approaches an off-screen archive heading, the working-board scrollport advances to reveal it; the
sidebar still owns exactly one scroll container.

`View all N` opens a transient archive index overlay, not a third right-pane mode. The overlay is scoped only to
closed sessions, reads the complete lean index once (the row projection is `id`, visible title, search label,
`closedAt`, and node), groups newest-first rows under sticky dates, filters locally, and
closes on Esc or backdrop press. Choosing an index row closes the overlay and hands selection to the ordinary
read-only Conversation, so the right pane always represents the selected session (or New Session), never an archive
page.

The archive index overlay reads the full closed-session lean index in one request, renders the newest-closed-first rows
under sticky Today / Yesterday / calendar-date headings, and owns a search field that filters that complete index
locally. Pagination is deliberately absent: the overlay's index scrollbar represents the whole result set from its
first paint. This overlay is the only archive-search entry; the global palette neither includes closed rows nor
hints at hidden archive matches. Esc/backdrop closes it, and choosing a row returns to that session's ordinary
Conversation in the right pane.

The console list is the mutable home of its session forest ([[session-nesting]]). Dragging a row moves a
full-row ghost, dims the original, and highlights a valid receiving parent; a nested row additionally exposes
a top-level drop zone. The ghost is the same console tree-row presentation as its source, derived again from
the current forest item rather than from a hand-copied appearance record: selection reveal, headline line boxes,
right-side status marker, nesting lead, fold pod, and select checkbox therefore retain their exact internal
layout. To keep a selected row's expanded headline readable without covering the receiving object, the pointer-owned ghost
is rendered at **75% of the source's visual size**, with its pointer anchor adjusted for that scale. Only the
wrapper's semantics differ — the source is an interactive button while the pointer-owned ghost is inert.
The gesture is deliberately ordinary pointer drag rather than a tiny dedicated handle: the row itself is what
will move, so the feedback must visibly be that row. Right-click keeps the complementary
explicit `remove from parent` action for a nested row. Both paths call the one reparent endpoint and leave
selection, terminal focus, and invalid/no-op drops alone.
Dropping a working row on the visible archive zone heading instead performs the row's one reversible `close` transition:
the row leaves the working board and enters the archive in the same gesture. This direct placement has no confirm;
close remains one action here because its retained record, branch, transcript, and archive ref make it reversible.

The [[dock-modes]] sessions projection is the desktop's sole session list. This document therefore never
renders an internal `si-list`, `si-board-scroll`, list resizer, or collapsed stub, regardless of dock mode;
the terminal or timeline occupies the full content width. The dock owns New Session and the archive index door,
while the document keeps archive/close/resume actions and exposes rename from its selected-session tools. The
dock remains read-only: drag-to-reparent and multi-select are explicitly retired with the duplicate list because
their mutable state cannot belong to a finding projection. The keyboard fresh-session binding remains unchanged.

**New Session** is a centred splash — the [[launch-hero]] block-letter wordmark — over an auto-growing
input. Like every dashboard-authored composer, it uses [[composer]]'s `ComposerTextarea`, whose one
`fitTextarea` measurement path grows through each content line without a scrollbar until the host's
declared cap. Composer keyboard meaning is deliberately split by product action: a **message** composer
(TimelineChat conversation or Command Box) sends on plain Enter, inserts a line on Shift+Enter, and never
sends the Enter that commits an IME composition; a **launch** composer (this New tab or the phone's Create
screen) is a long-form prompt, so Enter always remains native editing and only the explicit launch button
submits. Nothing is prefilled; typing **`[[`** opens the
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

An existing session has one visible **surface**. A pane-backed adapter offers Terminal, Conversation, Diff, and
published resource faces selected by the one session object address:
`#/sessions/<id>?surface=conversation|terminal|diff|resource:<resourceTabKey>`; a bare
`#/sessions/<id>` resolves the persisted base face, which is always Terminal or Conversation and never a diff
or resource ([[session-surface]]). The URL is the only selector and is a pure function of the
address; only a user gesture may navigate it. There is no in-console resource strip, dialog, or face-switch rail.
**What the console MOUNTS follows the resolved surface, never the stored preference.** Consulting the stored
base to decide whether to mount the conversation left `?surface=conversation` showing an empty pane on any
session whose stored base was Terminal — terminal layer hidden, conversation layer never created, and with it
the composer that is the human's only way to speak to a running session. The address decides what is on
screen; the store decides only what a bare address means.
Opening a published resource is an ORDINARY navigation to that address: it lands in the strip's current slot
like every other plain click, dedupes onto an already-open tab, and mints a tab of its own only from the
gestures that mint any tab ([[tab-strip]]). It used to force a resident tab, which is exactly the reflex that
filled the strip with things nobody decided to keep. Closing that tab closes the resource view;
the dock's sessions projection is the always-present free return to the session and never destroys its tmux/PTY.

Lifecycle does not create another right-pane face. **Every existing session, including offline and archived
records, renders the same Conversation DOM: one shared timeline body and one shared footer (no surface tabs).**
For a live session that footer is only the enabled message composer. For an offline session it contains the
same disabled, non-focusable composer followed by `⏻ agent 已离线 · 内容只读` and the ordinary relaunch
action. For an archived session it contains that disabled composer followed by `▤ 已归档 · 内容只读` and the
ordinary resume action. These are data states of one footer component, not separate panels. The timeline remains
readable without restoring the agent; archived history is immutable and cannot receive later `sent` events, while
an offline record may still be written by an external `spex session send`, so archived is the only state that reads
once when selected and does not poll. A pane-backed offline or archived record remains Conversation and cannot
be switched to Terminal. `queued` remains the one exception to offline relaunch: it has intentionally
not launched and self-starts as a slot frees.

That conversation is the whole terminal-free console, with no [[message-stream]] native-event drill-down. The
terminal mount keys on **liveness, never the lifecycle label**: a session whose process is gone reads `offline`
whatever its authored lifecycle (`asking`, `review`, `error`, …), so it never mounts a tmux client against a dead
id (which would leak tmux's bare "no sessions" into the pane). The terminal pane is **flat**: it fills the right area directly — no inner bordered box, no title bar,
no nested levels, and no permanently reserved second-input strip. Its own prompt and status line reach the
pane's bottom edge. `Alt+I` suspends [[command-box]] over the lower middle without resizing or reflowing
xterm; its fixed footer and upward growth belong to that temporary control surface. The shell tab row owns the
session document's action slot ([[document-actions]]); this document registers its merge, menu, resource-picker,
diff-door, and other session actions there. It does not render a second chrome band under the tabs. The shell's
top [[tab-strip]] names the session object with an i18n face suffix; Evals keeps its one canonical scoped address
and is reached by navigation.
The plus lists the selected session's posted
files and loopback web services ([[files]] / [[web]]) that are not already open. Selecting one creates one
browser-local tab for that exact session/reference; closing it removes only that view and permits reopening from
the plus menu, never a duplicate. Clicking a filename in the top-right files dropdown uses this same open/select operation for its
file row, so it cannot create a separate preview surface or a duplicate tab. A newly observed posted web service
never creates or selects a visible tab automatically. It raises the existing unread signal; clicking that signal is
the user gesture that opens/focuses its one address tab. Each resource tab exposes a close icon and a right-side **refresh** action:
for a file it rereads the current preview response, while for a web resource it recreates the same-origin iframe and
requests the current local-service response. A selected file also gets **download** and **copy path**, the same actions
offered by the files dropdown; those file-specific actions do not appear for a web resource. Removing a published
reference closes its resource tab. An open resource tab is a **warm browser instance**, not merely the selected
surface: its file preview request or same-origin iframe stays mounted, including its scroll position and page state, while
another resource, Terminal/Conversation, another session, or another routed page is selected; returning makes that same DOM
instance visible rather than rereading or reloading it. Its lifetime is anchored to its live session, not its selected state:
only the tab's explicit close, reference retraction, or session retirement releases it. Resource tabs and that session's warm
terminal share this ownership boundary: there is **no cross-session resource-tab pool, admission limit, or eviction**. A global
budget lets one live session starve another while terminals themselves remain unbounded; a per-session quota would still make a
session's resources shorter-lived than its terminal for no product reason. Each session may therefore retain every resource tab it
opens during that session's lifetime, independently of every other session. A selected resource tab is a
temporary browser-local overlay of that session's base surface: closing it, pressing the base tab, or Esc from
the resource returns to the same Terminal/Conversation base without changing that preference. The diff face is
an overlay on the same terms — Esc and its own lit door both return to the bare address. The browser
persists the pane-backed base choice per session and project; a session without an explicit choice resolves the
Settings default, then Terminal. Switching sessions may restore its still-open resource overlay, but resource
selection is never persisted or written to the session/backend, and a bare session address always opens the
persisted base rather than whatever overlay was last on screen. Neither console adds a second native-event view. Session identity, lifecycle,
and liveness do **not** repeat here: the selected row in the
left session list is the console's visible identity/state surface, so a second headline/status group only spends
height and injects volatile prompt/HTML text into `aria-label` / `data-tip`. The Eval tab is a REAL anchor whose href is
the canonical session-scoped Evals list address (the scoped default query, minted by [[address-routing]];
copy-link/middle-click work for free), so clicking it (or the typed
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
only empty state, distinct from loading, updating, disconnected, dormant, and error.

**A spinner is a promise that a value is arriving, so only an arriving state may spin.** The door spins for
`loading` and `updating` and for nothing else. A **dormant** projection ([[session-eval]]: a retained offline
session the backend deliberately does not precompute) and a selected row carrying no projection at all (a
closed session, which leaves the board and is served from the archive index instead) are the same fact — no
value is coming until someone asks for one — and the door says so: last-known counts when it has them, a
still blind-spot mark when it does not, and an accessible name naming the door itself as the way to measure
it. The door is already that anchor, so opening it is the whole repair; the console never fetches a summary
of its own to fill the gap.

The session document renders no internal toolbar. Its merge, menu, resource picker, diff door, Command Box,
relaunch, and selected-resource actions register with the shell's [[document-actions]] slot at the tab row's
right edge. The slot keeps one compact icon-button geometry across themes, locales, lifecycle and liveness;
disabled merge remains visible with the exact localized availability reason as its tooltip. The resource picker
is the one posted-files/web-services entry point, and a document with no posted resources leaves its menu empty.
Surface choice is address state (`?surface=…`), not an in-document switch control; the diff door uses the distinct
`file-diff` glyph and navigates to the diff address, and on the diff face that same door stays in the slot,
LIT, and navigates back to the bare session address — an overlay's door opens and closes, because a door that
only opens makes the surface a trap for a reader whose tab strip holds one deep link and whose dock is closed.
The slot also carries the session's own **lifecycle menu** (the ellipsis): it is the only route on this surface
to rename, tmux attach, and lock-on-graph, and its tooltip names those rather than describing a shape. Its twin
is the right-click on a finding-dock session row ([[dock-modes]]) — one menu, two ways in, the slot for the
session you are reading and the dock for any other. Other document kinds register nothing, so their tab-row edge
is blank.

**The console cancels the native context menu nowhere.** It once cancelled it for the whole panel, which was
survivable while a session list filled most of that panel and did own a right-click menu of its own; with the
list withdrawn the panel is conversation text, diff text and a terminal, and the blanket cancel bought nothing
while taking copy, paste and search-selection away from all three. A surface may suppress the native menu only
where it offers one in its place.
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

The desktop right pane has **one console slot with two mutually exclusive base surfaces plus a resource overlay**.
A pane-backed adapter keeps the warm, input-enabled `SessionTerm` described here and mounts the same
`TimelineChat` used by the phone on first Conversation visit. A headless adapter mounts only that Conversation,
with no terminal placeholder, tmux socket, or [[message-stream]] alternate view. A selected resource tab
replaces either base surface with a bounded, top-anchored selectable file preview or same-origin web frame; Markdown
uses the same restricted renderer as other dashboard prose while raw HTML remains text. File text is the explicit
native-selection exception to the panel's pointer-inert chrome, so drag and Ctrl/Cmd+C work while its non-focusable
surface leaves the current terminal/composer sink alone. The inactive terminal layer is hidden
and pointer-inert, preserving its warm transport. A selected **web** resource is its own input sink: on every selection
(the picker, its tab, automatic opening for the selected session, or restoring that session's local surface) focus enters its
same-origin iframe without an in-page click, so ordinary keys including arrows belong to the published page immediately. The
dashboard's reserved controls stay reachable: its documented Alt chords relay back to the console, and Escape first peels the
shared [[esc-layers]] top layer (including the open resource picker); only when that stack is empty does it return to the session's Terminal/Conversation sink. Thus a
web frame cannot lock the dashboard controls, and one Escape never skips an overlay to switch the resource surface underneath it.
TimelineChat's
message composer is the shared [[composer]] textarea and auto-growth path, with the same Enter / Shift+Enter /
IME-send boundary as Command Box; its docked mobile and desktop hosts do not invent a second textarea
mechanism.

**Both session surfaces frame their content identically.** The Conversation's composer FLOATS over its
reading column, the same shape Command Box already has on the terminal surface, and the timeline pads its
tail so the newest entry is never parked behind it. That is what makes the surface a property of the
content and not of the frame: choosing Terminal or Conversation changes what fills the document area, never
how many chrome rows sit around it, which is exactly the claim [[ui-state-model]]'s budget measures. The
composer's card IS its field — one frame, not an input bordered inside a bordered bar. TimelineChat's composer always sends `replyVia:"note"`: this is the fixed
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
[[terminal-input]] and [[focus-return]] carry the contract): pressing rows, zone headers, parent disclosure rows, the
resizer, pills, document-action buttons, or the launcher pop acts without taking focus, so the current sink — TUI,
Command Box, or the New composer — keeps typing focus through any pointer work on the console, and a pop
that does take focus returns it on exit. Only the composers' own textareas, the rename input, and the xterm
screen take pointer focus.

[[command-box]] is the authored control channel, opened by its resident document-action icon or the reserved single-
modifier `Alt+I` chord. It floats in the lower middle, never reserves terminal layout, and uses
[[composer]]'s fixed footer with upward auto-growth. The draft belongs to the session and survives closing,
tab switches, and routing to Evals. Escape or an outside click closes it and returns focus to xterm; an
Modified Command/Ctrl/Shift combinations stay with the browser. An **Enter that commits an IME composition** belongs to the input and
never sends; plain Enter sends, while Shift+Enter adds a line.

Command Box dispatches by **appending to the target's durable log** ([[dispatch]]), never typed into the pane,
so one prompt lands atomically even in tmux copy-mode. Its right-pane action-outcome surface shows only the
in-flight `sending...` state. A failed 502 keeps the complete draft and the box open for retry, and carries
no delivery marker of its own: a send either put the bytes in the log or did not, so a retry can only ever
repeat something that never landed. Once either result settles, it visibly acknowledges through the shared
[[transient-notices]] stack — a short-lived delivery/failure result outside the Command Box's geometry —
before a successful send clears the draft and closes the box. A `/` line
may instead name a **board command**, intercepted client-side because sending that word to the agent cannot
operate the board. One registry (`sessionCommands.js`) feeds those rows and every document-action twin, sharing action,
availability, identity colour, localized label, and icon. `/stop` stops the agent but keeps its resumable
worktree; `/close` performs the soft terminal transition into the permanent archive place ([[archive]]),
removing the worktree while retaining the branch, record, and conversation; `/merge` is offered
only for the live review proposal declared by `done --propose merge`; `/eval` opens the canonical
session-scoped Evals page.
Lifecycle actions consume both HTTP status and the structured `{ok,error}` body before the board reloads, so
a refused stop/close/relaunch remains visible instead of reading as a successful background no-op. Command Box
and lifecycle actions use one selected-session, right-pane action-outcome mechanism only while they are pending:
Command Box owns `sending...` while open; an existing-session action owns `working...` in its selected
action surface. Settled delivery and failure publish once through [[transient-notices]], so neither an
old refusal nor a success permanently spends console geometry. The left session list is navigation-only and
renders no action alert. Bulk close leaves select mode immediately but aggregates every returned
refusal into that same selected-session result, so an HTTP conflict never exists only in browser tooling.
**Prompt delivery and a lifecycle transition remain distinct while pending:** the former
reports `sending...`, while the latter reports the neutral `working...`; reusing delivery copy for relaunch,
stop, close, or merge would falsely claim the dashboard sent the agent a prompt.
There is no `/type`. Board commands lead the menu tagged `[ui]` and run on acceptance; live command presets
tagged `[preset]` and harness commands follow as authoring rows that insert their token. Names deduplicate by
that precedence. `[[node]]` resolves at send to the node id plus its live `spec.md` pointer; `@session` stays
a passive [[mentions]] reference, while `@new` uses the selected session as the spawned worker's durable
parent and therefore folds that child below it. File paste, drop, and pick reuse [[file-attach]].

A **right-click on a session row** opens its context menu — **lock on graph**, rename, archive or close
([[session-rename]] / [[archive]]), select for bulk archive/close and drag-to-reparent
([[session-multi-select]]), and **attach** for a live row ([[attach-menu]], which hands over the
`spex session attach <id>` command to join the session's real tmux) — coexisting with the context-menu
suppression. Archive and close share the menu's danger group and each confirms before its lifecycle request.
Lock on graph locks the board to that session and navigates to
`#/graph`; it has no pending-ops precondition, so an ops-less session still lands on the graph with the lock
banner explaining the empty grip. The shared `sessionName` puts a rename first in the label precedence.
Context menus and anchored dropdowns use their border with shallow ambient depth only; they do not cast a bright
halo around the menu edge.
The row order is **automatic** — the two-zone grouping below, newest-first within a zone — with no manual
drag-to-reorder gesture. Both authored composers accept an **attached file** (paste, drop, or the paperclip picker — a monochrome inline-SVG
glyph in the dashboard's own icon vocabulary, swapping to a spinning ring while uploading, **never a colour
emoji**). Their shared file-attach projection is per file — name, byte progress, final/failure state, and retry or
cancel affordance — so one failed item never collapses a batch into a generic spinner. Only a completed backend
(= worker) `/tmp` path is spliced into the composer; transfer protocol, policy, and storage semantics belong to
[[file-attach]].

Pane-backed terminals are **warm and always connected**: every live pane mounts and opens its socket when the
console is first entered — never lazily on focus — and stays mounted even while the console is closed, so
switching tabs **never loses your place** (socket + last painted buffer survive), New Session included. A
pane-backed Conversation mounts only on its first visit, then remains mounted after deselection or going offline
so its timeline cursor and rendered history survive revisits; its refresh timer runs only while selected.
Headless sessions follow that same Conversation lifetime from their first selection. Unvisited Conversation
surfaces remain inert and make no timeline/detail reads or polling timers. Hidden
pane-backed layers remain laid out at the final terminal geometry under `visibility:hidden`, keeping their xterm
and stable default renderer ready; switching changes visibility, not socket attachment or renderer identity. No pane loads a visibility-scoped WebGL addon,
so hidden sessions neither expose an empty replacement renderer nor accumulate capped GPU contexts. [[live-view]]
owns the matching backend rule: an unselected session, a closed Sessions route, or a background browser tab
owns no raw PTY or tmux geometry, while a visited hidden xterm keeps its cached pixels for an immediate return
paint. List navigation lives at the **window level** only when focus is outside xterm and every text input.
Plain **↑/↓** therefore walk the list from inert console chrome, while the live TUI and the New/Command Box
textareas keep their own arrows entirely. To switch sessions while typing or driving the TUI, use the modifier combos:
**⌥+↑/↓** are an **unconditional** switch — they step the selection up/down the list from anywhere, no
matter which input has focus (the guaranteed up/down switch a work console gives you). The same window router
reserves **⌥+Shift+↓ to expand and ⌥+Shift+↑ to collapse** the selected row's existing [[session-nesting]]
fold. It consumes those chords before the ordinary ⌥+↑/↓ session move, so selection never changes; a leaf or
already-matching state is a no-op. Unmodified arrows and every editable control keep their native key, and the
action never changes session data. A transient overlay's own focused control also keeps its native keys: the
window router yields before any New-tab or list shortcut when the event target is inside a `data-focus-overlay`,
so a visible confirm's Enter cannot launch a New Session behind it. **⌥+N** reaching the New Session composer is no longer this console's own
chord — it belongs to [[side-nav]]'s app-global ⌥ command family (⌥N / ⌥F / ⌥1..⌥5), which the console's
key handling deliberately **falls through unhandled** so the window-level handler
routes it and tmux never sees `M-n`/`M-f`/`M-digit`. (The family is ⌥-based for the same hard browser limit
that shaped the old chord: **⌘/Ctrl shortcuts remain native/browser-owned**, while ⌥ is the modifier the app
can actually own.) The shell's document-actions slot renders the session's registered icon actions. The top-right [[files]] icon is grey when the
selected session's projected path list is empty; otherwise it opens a file-name-only list whose full paths live in
hover tooltips. The base surface is selected by its route address; there is no pane-backed Terminal/Conversation
switch control, painted divider, wrapper boundary, or extra gutter separating the document actions: the whole
right edge uses one shared icon gap and one outer padding. Clicking the filename opens or selects the
singleton resource tab; the adjacent download and copy tools remain explicit icon actions, with download
delegating to the authorized backend route. **Command Box** is present whenever live. The
document-action set is surface-specific: every selected resource shows its one refresh tool; a selected web has
no file download/copy actions. Merge is green and dispatchable only for the
persisted `awaiting` + `proposal:merge` + `review` projection while liveness is `online`; `nothing`/done,
close-pending, working, asking, and every non-online reading keep the tool muted and disabled, with a
localized tooltip and accessible reason. An activation is one plain `POST /merge`: no preliminary review read,
request body, idempotency key, Git identifier, or client-side merge authority. Disabled merge never appears as a
typed `/merge` command and never dispatches. Every visible
action uses one shared compact icon-toolbutton primitive and a familiar [[icon-system]] / Lucide mark
(command, git-merge, rotate/relaunch), with its registry identity colour; there is no emoji, visible text
label, or document-local icon/action mapping. The registry remains the single row that decides availability,
colour, typed twin, localized tooltip/`aria-label`, pressed state, and execution. Command Box exposes
`aria-pressed` plus a stable selected treatment; an `offline` liveness (any lifecycle) also exposes the same
primitive's relaunch action, and review is **agent-proposed** at the stop-gate. **The evaluation is no longer one of these buttons** — it is the
permanent **Eval navigation tab**, always available for any selected session (see [[session-eval]]): the document-action entry
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

**The finding dock's session projection** ([[dock-modes]]) is the read-only glance, built from the shared
**`SessionRow`** face ([[session-activity]]) in the SAME **compact one-line, zone-grouped** layout as the
console list: the session
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
status is a single colour glyph, not a word. The
list itself **groups into three triage zones** — *needs you* (asking / review / done / close-pending / error)
over *running* (working / parked / starting / queued …) over **offline** (dormant, at the bottom), a dim
header leading each — and within a zone the **newest** session sits on top. The **offline** zone is keyed on
**liveness, not the authored lifecycle**: a session whose process died while it was `asking`/`review`/`error`
keeps that pre-death lifecycle, yet it cannot act until relaunched, so it sorts to **offline** rather than
wrongly sitting under *needs you*; a merely booting session (`starting`/`queued`) stays under *running*. The
**offline zone rests folded behind its own header** — the ONE disclosure for session history. Its header is a
single row with the COUNT badge first and the `OFFLINE` label second; it contains no `>`/chevron/caret/`▸`
direction symbol. Retired and
dormant sessions accumulate (an adopter's CR record sessions are deliberately kept alive for their external
deep links), and a list that renders every one of them drowns the two zones a human acts on; but they are
records, so they are never deleted and never more than one click away. The whole header is the disclosure button:
it carries the one `aria-expanded`, toggles the zone from its label or trailing rule area, and is keyboard reachable.
The COUNT pod is only a visual marker inside it. A parent
row with sub sessions uses the same grammar: its child-count pod is the first content before the title/status
body, never a trailing action, and that pod alone toggles its children and carries `aria-expanded`. Clicking
the rest of the parent row performs that surface's ordinary row action (select/open in the console or phone,
graph claim from a dock row) without changing the fold. The disclosure pod and row action are sibling
controls in the DOM, never a button nested inside another button. Neither surface renders a directional glyph
for parent disclosure; hierarchy is communicated only by the count's leading slot, indentation, and the
resulting row structure.
Folding is **presentation only** (per-surface state, collapsed again on a
fresh mount; no session record is touched), it applies to **no other zone** — *needs you* and *running* rows
can never be hidden by any fold — and the **selected session stays revealed**: a row chosen by URL,
search, an originator chip, or the graph's node menu renders even while its zone is folded, so a deep link
into history always lands on its visible row. ↑/↓ walk only the visible rows, as with every fold. The
selected row is marked by the **highlight wash alone**, no caret. The SessionInterface sidebar, the finding
dock's projection, and the phone Sessions list share this grouping + compact one-line layout.

All surfaces share name and status from `session.js`, whose single **`STATUS_COLOR`** map paints the
liveness dot, the status word, **and** the compact sidebar's status **glyph** (`STATUS_GLYPH`) the SAME hue
everywhere they appear (window row, console sidebar row, @-mention and search rows, the mobile card).
The document-action slot deliberately carries none of these identity/status marks. Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
