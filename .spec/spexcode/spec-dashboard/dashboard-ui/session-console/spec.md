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
  - spec-dashboard/src/sessionListState.js
  - spec-dashboard/src/harness.jsx
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/styles.test.mjs
  - spec-dashboard/src/statusVocabulary.test.mjs
  - spec-dashboard/src/sessionToolbar.test.mjs
  - spec-dashboard/src/textarea.test.mjs
  - spec-dashboard/test/session-toolbar.e2e.mjs
  - spec-dashboard/test/session-web.e2e.mjs
  - spec-dashboard/test/session-command-preset.e2e.mjs
  - spec-dashboard/test/session-tree-disclosure.e2e.mjs
  - spec-dashboard/test/session-shortcuts.e2e.mjs
  - spec-dashboard/test/session-sidebar-scroll.e2e.mjs
  - spec-dashboard/test/conversation-scroll-survives-switch.e2e.mjs
  - spec-dashboard/test/command-box.e2e.mjs
  - spec-dashboard/test/lifecycle-outcome.e2e.mjs
  - spec-dashboard/test/timeline-chat-composer.e2e.mjs
  - spec-dashboard/test/session-surface-cold-readable.e2e.mjs
  - spec-dashboard/test/session-archive-zone.e2e.mjs
---

# session-console

## raw source

`Enter` on the board opens the focused node's info popup; explicit session links and node-menu actions open the
session interface. The finding dock's session projection is the at-a-glance summary. The dock and the console's
working-session rows take lifecycle state from `/api/graph` (i.e. `spex graph --json`), while the console also uses
the documented archive index, retained-record, timeline/detail, and post-create transitional projections. Those
secondary projections do not become a second lifecycle authority, so a human watching the dashboard and an agent
driving the same sessions through the CLI see the same reported session state.

The backend's closed `DisplayStatus` vocabulary is the one lifecycle word source for the dashboard. The
session projection, both locale dictionaries, and every status-word surface cover the full set, including
`unknown`, `corrupt`, and `retired`; an untranslated `status.*` key is never a valid display.

A persisted session **rename** is a graph-stream action, not a private action-refetch: after the route commits
the name and nudges the sessions domain, the visible row advances from the delta stream. A
concurrent structural full may continue in the background, but the newest session projection reaches the console
first and structural convergence must not replace it with an older row. The rename surface may recover a failed
write, but a successful rename does not hide the push path behind a second `/api/graph` request. Archive and
close retain their own action/recovery contracts.

## expanded spec

The interface is a **routed page** (`#/sessions`, [[side-nav]]) — it fills the app's main area beside the
navigation rail as a peer of the graph, with no backdrop, no lift, no pop: Enter (from the graph) or the
rail navigates to it, leaving it is likewise navigation (the rail, an address, history — never Esc,
which stays inside the console's own stack), and its selected tab echoes into the URL (`#/sessions/<sel>`)
so a tab can be deep-linked. Selection validity is the real board session set, not only the currently
visible rows: a session hidden under a collapsed nesting parent can still be opened by URL, search, or an
originator chip, while ↑/↓ navigation continues to walk only the visible forest rows. Opening such a
hidden session from outside the list — including the graph's node menu — automatically unfolds every present
ancestor in the console's nesting forest, so the selected row is revealed instead of remaining hidden.
The console and its `SessionInterface` descendant never write the global route directly. Their host-provided
`ViewScope` owns every session selection, launch result, eval door, archive return, and resource/base-surface
transition. Resource and base-surface changes keep their exact `surface` query, while diff/base exits retain
replacement semantics; moving the write behind the scope does not flatten those address axes. Plain hrefs may
still use the shared `routeHash` projection, but imperative writes dispatch one checked `open` intent to the shell.
Selecting a session row is one plain navigation to its canonical session address; [[tab-strip]] decides whether
that focuses an already-open tab or replaces the focused session tab. A row click never rewrites the active
session A tab to session B while B is already open elsewhere.
The routed adapter holds no mirrored selection state: its current `param` is the selection passed to the console,
and every console selection intent returns through that adapter's one `ViewScope` route writer.
Leaving the page keeps the console document, its selection, and every visited pane-backed terminal mounted;
switching tabs changes visibility rather than rebuilding xterm or its browser WebSocket, so the cached screen and
focus return without a cold start. The active transition claims `visible:false` on the bridge; the bounded native
linger may release the raw PTY/tmux client while the browser terminal/socket remain resident, and reactivation's
resize claim restores that native bridge. While the Sessions page is visible, only the selected terminal owns the
visible geometry claim; a headless TimelineChat keeps its rendered timeline cursor, polls only while selected, and
resumes from the latest board snapshot when selected again. **The console's warm Conversations are a bounded
working set.** The two layer sets answer to different rules and the console must not confuse them: a terminal
is warm because its session HAS A LIVE PANE, so that set is bounded by the board and shrinks on its own, while a
Conversation is warm because someone LOOKED AT IT, which is a set that only grows. The console therefore keeps
the most recently shown Conversations up to the same working-set limit the workspace puts on mounted documents
([[workspace-shell]]), evicts by least recently shown, and never evicts the selection. **That recency order is
the eviction's alone and never reaches the screen.** The warm layers sit absolutely positioned over one another,
so their order in the document says nothing to a reader — but ordering them by anything the selection moves is
how the console threw away a reader's place in a Conversation: reordering keyed children detaches the node and
re-inserts it, and a scroll container that leaves the document comes back at the top. The mounted layers
therefore keep a stable MOUNT order: a layer holds the slot it arrived in for as long as it stays mounted, and a
newly warmed one is appended after it, so selecting another session changes what is visible and nothing else.
Reading position is part of what keeping a Conversation mounted is for, exactly like the timeline cursor beside
it ([[conversation]]), and a switch away and back must return the reader to the line they left. It is one bound answering
one question — how much does an idle console hold — so a second limit keyed to memory, node count or session age
would be a second answer to it. The console's own composer drafts live in the console's state, so it also owes
its mounted layers referentially stable props: typing into the New prompt or the Command Box must cost the same
whether one Conversation is mounted or the whole limit is. A pane-backed terminal's warm hold ends when the
canonical session projection is no longer a live pane (offline or archived); its socket and native terminal are
disposed while the read-only Conversation remains available. Open resource tabs follow the same display-hidden
lifetime: changing tab, session, or route never unmounts their preview or frame. Page display itself
belongs to the shell's shared pane boundary ([[side-nav]]), so the console renders only content and never
toggles its own display. The console **follows
the app theme**: its chrome — the session list, right frame, and Command Box — uses the same palette tokens as
the rest of the dashboard, so re-theming the app re-themes the console with it (no console-scoped palette
remap). The one surface that stays dark on its own is the **embedded terminal** (`--term-bg`) — legitimately a
dark terminal, whatever the app theme. The document has one right area that
**morphs** by what's focused. Search remains available through the shell palette and the existing ⌥+/ binding;
the sessions dock owns the list's `＋` New Session door. The forest sidebar's row grammar — its three doors (New,
archive, search), zone heads, the archive zone and its routed `archive=1` index overlay, drag, and the keyboard
walk — is [[session-forest]]'s. The forest registers that walk with the shared window keyboard service beside
the rows it owns; the document keeps the input, menu, and plain-arrow portions of the console scope. It keeps
no BOOKKEEPING for the walk either — no second index of which rows are foldable — because a derived set kept
beside a mechanism it no longer drives is how the two drift back apart. The document is bounded by
the routed page's viewport and owns the terminal/timeline surface without a second navigation scrollbar.

**New Session** is the console's launch tab — the [[launch-hero]] wordmark over the launch composer and the launcher
picker; its grammar, background fire, and picker are [[new-session-tab]]'s. Its focused composer submits on plain
Enter, inserts a newline on Shift+Enter, and leaves IME composition Enter to the browser; the visible launch control
is the pointer twin, while an open completion menu consumes Enter for its highlighted choice first.
When its create response publishes a session id, the address is marked for a new tab before routing so creation
appends a fresh workspace tab and cannot replace the session tab the reader was on.
The picker has no configuration or add action; its pop-out exposes a settings link, and launcher profiles are
owned by the routed Settings page.

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
Published files and web services open as resource tabs beside the session document ([[resource-tabs]]).

The shell tab row owns the
session document's action slot ([[document-actions]]); this document registers its menu, resource-picker,
diff-door, and other session actions there. It does not render a second chrome band under the tabs. The shell's
top [[tab-strip]] names the session object with its headline and status dot, with no face suffix; Evals keeps its one canonical scoped address
and is reached by navigation.
Neither console adds a second native-event view. Session identity, lifecycle,
and liveness do **not** repeat here: the selected row in the
left session list is the console's visible identity/state surface, so a second headline/status group only spends
height and injects volatile prompt/HTML text into `aria-label` / `data-tip`. The Eval door — a real anchor to the canonical session-scoped Evals address, carrying a bounded glance over the
session's `evalSummary` — is [[eval-door]]'s, and it rides the frame's AMBIENT LINE rather than this document's
action slot: the slot holds verbs that act on the session, while the door is a persistent readout of how the
session's measurement is doing. The console registers it only while its own pane is the READ document, because
the workspace keeps hidden documents mounted and a readout left behind would describe a document nobody has open.

The session document renders no internal toolbar. Its menu, resource picker, diff door, Command Box,
relaunch, and selected-resource actions register with the shell's [[document-actions]] slot at the tab row's
right edge. The slot keeps one compact icon-button geometry across themes, locales, lifecycle and liveness. The resource picker
is the one posted-files/web-services entry point, and a document with no posted resources leaves its menu empty.
Surface choice is address state (`?surface=…`) controlled by two compact icon buttons in the document-actions slot:
one terminal/conversation button replaces the URL and updates the remembered base face, while the independent
`git-compare` button replaces the URL with the diff face and uses `aria-pressed`; leaving diff returns to the remembered
base face and leaves the session tab alone. Both are omitted when the session has only one available face (headless,
offline, or archived). The slot also carries the session's own **lifecycle menu** (the ellipsis): it is the only route on this surface
to rename, tmux attach, and lock-on-graph, and its tooltip names those rather than describing a shape. Its twin
is the right-click on a finding-dock session row ([[dock-modes]]) — one menu, two ways in, the slot for the
session you are reading and the dock for any other. Other document kinds register nothing, so their tab-row edge
is blank.

**The console cancels the native context menu nowhere.** It once cancelled it for the whole panel, which was
survivable while a session list filled most of that panel and did own a right-click menu of its own; with the
list withdrawn the panel is conversation text, diff text and a terminal, and the blanket cancel bought nothing
while taking copy, paste and search-selection away from all three. A surface may suppress the native menu only
where it offers one in its place — as the Conversation's timeline does, and only while a passage is selected
there ([[conversation]]).
The desktop right pane has **one console slot with two mutually exclusive base surfaces plus a resource overlay**.
A pane-backed adapter keeps the warm, input-enabled `SessionTerm` described in [[terminal-io]] and mounts the same
`TimelineChat` used by the phone on first Conversation visit. A headless adapter mounts only that Conversation,
with no terminal placeholder, tmux socket, or [[message-stream]] alternate view.

A pane-backed console's two input channels — xterm by default, the Command Box out of band — are
[[terminal-io]]'s. The console's authored composers — the New prompt, the Command Box, and the Conversation
footer it mounts — carry no grammar or upload machinery of their own: each arms [[mentions]]' one
autocomplete hook (with its own `/` palette and pick rule) and [[file-attach]]'s one attachment hook, and
the console's keyboard router drives whichever hook belongs to the active surface. A door on any of these
composers therefore opens the same menu and the same upload path as the others.

Around both channels, **console chrome is pointer-inert for focus** (the panel-wide blanket;
[[terminal-input]] and [[focus-return]] carry the contract): pressing rows, zone headers, parent disclosure rows, the
resizer, pills, document-action buttons, or the launcher pop acts without taking focus, so the current sink — TUI,
Command Box, or the New composer — keeps typing focus through any pointer work on the console, and a pop
that does take focus returns it on exit. Only the composers' own textareas, the rename input, and the xterm
screen take pointer focus.

[[command-box]] is the authored control channel — `Alt+I`, a floating composer, dispatch by durable log, board
commands — and states its own delivery contract. Lifecycle actions consume both HTTP status and the structured `{ok,error}` body before the board reloads, so
a refused stop/close/relaunch remains visible instead of reading as a successful background no-op. Command Box
and lifecycle actions use one selected-session, right-pane action-outcome mechanism only while they are pending:
Command Box owns `sending...` while open; an existing-session action owns `working...` in its selected
action surface. Settled delivery and failure publish once through [[transient-notices]], so neither an
old refusal nor a success permanently spends console geometry. The left session list is navigation-only and
renders no action alert, batch-selection state, or bulk lifecycle action. Any future batch operation must be
specified as an explicit selection mode owned by the dock session list.
**Prompt delivery and a lifecycle transition remain distinct while pending:** the former
reports `sending...`, while the latter reports the neutral `working...`; reusing delivery copy for relaunch,
stop or close would falsely claim the dashboard sent the agent a prompt.
A right-click on a session row opens the session's one context menu ([[session-rename]]).

Every authored composer, the Conversation footer included, accepts an **attached file** (paste, drop, or the paperclip picker — a monochrome inline-SVG
glyph in the dashboard's own icon vocabulary, swapping to a spinning ring while uploading, **never a colour
emoji**). Their shared file-attach projection is per file — name, byte progress, final/failure state, and retry or
cancel affordance — so one failed item never collapses a batch into a generic spinner. Only a completed backend
(= worker) `/tmp` path is spliced into the composer; transfer protocol, policy, and storage semantics belong to
[[file-attach]].

Which layer a session mounts — a warm, always-connected terminal for a live pane, the Conversation for everything
else — and how hidden layers keep their place are [[terminal-io]]'s and [[conversation]]'s.

The shell's document-actions slot renders the session's registered icon actions. The top-right [[files]] icon is grey when the
selected session's projected path list is empty; otherwise it opens a file-name-only list whose full paths live in
hover tooltips. The base surface is selected by its route address and the document-actions slot exposes one compact
terminal/conversation icon that replaces the URL and remembers the chosen base face. A separate `git-compare` icon
enters or leaves the diff URL with `aria-pressed`; it returns to the remembered base face and is visually distinct from
the diff action. There is no painted divider, wrapper boundary, or extra gutter separating the document actions: the whole
right edge uses one shared icon gap and one outer padding. Clicking the filename opens or selects the
singleton resource tab; the adjacent download and copy tools remain explicit icon actions, with download
delegating to the authorized backend route. **Command Box** is present whenever live on the terminal
surface; Conversation owns the same command-shaped footer, so its toolbar opener remains visible but
disabled and cannot create a second input overlay. The
document-action set is surface-specific: every selected resource shows its one refresh tool; a selected web has
no file download/copy actions. Merge has no document action, disabled witness, localized availability copy, or
dashboard-local runner. `/merge` comes from the [[merge]] plugin and is sent to the agent as a resolved prompt;
the supervisor-facing `spex session merge <SEL>` remains the one external dispatcher for that same workflow.
Every visible action uses one shared compact icon-toolbutton primitive and a familiar [[icon-system]] / Lucide mark
(command, rotate/relaunch), with its registry identity colour; there is no emoji, visible text
label, or document-local icon/action mapping. The registry remains the single row that decides availability,
colour, typed twin, localized tooltip/`aria-label`, pressed state, and execution for dashboard-owned commands. Command Box exposes
`aria-pressed` plus a stable selected treatment; an `offline` liveness (any lifecycle) also exposes the same
primitive's relaunch action, and review is **agent-proposed** at the stop-gate. **The evaluation is no longer one of these buttons** — it is the
permanent **Eval navigation tab**, always available for any selected session (see [[session-eval]]): the
ambient-line door or Command Box `/eval`, each navigating to the session-scoped Evals page. The reserved Command Box chord is
consumed but inert for offline/queued sessions, using the same registry judgment as the button. There is
**no close/exit button** here (neither has a button twin — a strip "close" misreads as "close the panel"
while it discards the worktree): the destructive **close** (worktree removal) lives only on the row's
right-click menu, behind a confirm ([[session-rename]]); both verbs are otherwise reachable as the typed
`/stop`·`/close` commands above.
**Closing is record-preserving**: a successful close removes the row from the working forest, but the selected
session address stays in place and its right pane becomes the archived/offline Conversation. The retained
id-addressed record is read while the working projection and archive index converge, so closing from the current
tab never throws the reader into New Session. If the selected id is genuinely unreadable (a 404 or an invalid
deep link), the console falls back to New Session; a reader already moved to another valid tab keeps that switch.
The same rule covers a session that ends or is closed elsewhere.

The finding dock's session projection is [[dock-modes]]'s read-only glance over the same rows. Every row surface reads name, status colour, and glyph from one projection ([[session-row]]).

The root may evolve shared frame mechanics while this console keeps the same document, dock, and explicit
terminal-input ownership; such shell changes do not create a second session-console surface.

The Sessions document owns its frame chrome: the forest sidebar is the left sibling of a right-hand document
column, and that column contains the shared workspace TabStrip above the console content. The shell omits its
outer TabStrip on the Sessions route, so the forest's width pushes the strip and content right together rather
than allowing the strip to span above a list. The forest folds from the rail's panel control ([[side-nav]])
through the workspace's one dock open/closed state — the console keeps no fold state of its own — and while
folded the document column takes the full width. Folding is the frame's one shared movement ([[dock-modes]]):
the sidebar outlives the closed state by a single panel duration and slides out before it unmounts, the same
way the left dock and the right context dock do. It is the same gesture on the same panel, so it cannot be a
second timer with its own idea of how long a fold takes. A session tab's right-click enters the same session context menu
as a row (lock, rename, select, attach, detach, resume, quarantine, and close); the old duplicate
`session-menu` document-action button is absent.
