---
title: session-forest
status: active
hue: 280
desc: The console's forest sidebar — one row grammar with two doors, four triage zones with the offline and archive folds, the archive index overlay, drag-to-reparent with the row's own ghost, and the keyboard walk that never steals a typing sink.
code:
  - spec-dashboard/src/SessionForestPanel.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx#ArchivePage
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/sessionListState.js
  - spec-dashboard/src/session.js
  - spec-dashboard/test/session-tree-disclosure.e2e.mjs
  - spec-dashboard/test/session-sidebar-scroll.e2e.mjs
  - spec-dashboard/test/session-archive-zone.e2e.mjs
  - spec-dashboard/test/session-shortcuts.e2e.mjs
---

# session-forest

The left sidebar of the [[session-console]] is the mutable home of the session forest: the complete list a human
triages, moves, folds, and walks. Its rows are [[session-row]]'s shared face; this node owns what the LIST does
with them — grouping, disclosure, the archive's fourth zone and its index, the reparent gesture, and the keys.

**The forest sidebar speaks one row grammar**: its three
doors at the top — `＋ New Session` carrying its word, then quiet archive and search glyphs — are rows
in the same shape as the sessions beneath them, not boxed buttons; a session row is an inset rounded band
that wears the hover wash under the pointer and the selection wash when current, with no rule drawn between
rows. Its overlay colour is a **continuous 2px status thread**: on top-level rows it spans the complete row
height at the same leading offset, so adjacent rows touch; group headings naturally break the thread. It hangs on the ROW, at the list's own left edge, so it is the same
line at every fold depth: a thread carried by the indented row body stepped right with each level and stopped
reading as one line at all. The tree's connector rails stay uncoloured — the thread is the list's edge, the
rails are the shape of the tree, and neither has to borrow the other's job.

The console renders the row in its **compact, avatar-less** variant
(`showAvatar={false} compact`): the console's own left list is a dense one-line-per-session list at rest, with
a resizable width — 204px by default, bounded to 180–480px, persisted per browser, dragged on its separator and
reset by a double-click — and meta-size row text; the selected headline may expand
in place to **at most three lines**, with its complete text retained in the tooltip/accessibility name. The
status is a single colour glyph, not a word. The
list itself **groups into three triage zones** — *needs you* (asking / review / done / close-pending / error)
over *running* (working / parked / starting / queued …) over **offline** (dormant, at the bottom), plus the
fourth **archive** zone for closed records, a dim header leading each — and within a zone the **newest** session
sits on top. One `sessionDisplayState` projection drives both this bucket and the row glyph directly from the
`/api/sessions` status: archived records form archive; asking/review/done/close-pending/error form needs-you;
working/queued and other active values form running; offline/retired form offline. Liveness is secondary detail
and never rewrites the package status, so a dead asking/review record remains in needs-you with its lifecycle glyph.
Parentage follows the stored relationship rather than a dashboard liveness split. The
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

Every session zone starts with the same compact group head: semibold label and outlined count pod inherit the
zone's `--zh` hue, and one quiet hairline continues from the label to use the remaining row width. The line never
becomes a full-width divider above or below the group.

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

The top archive glyph and `View all N` open the same transient archive index overlay through the routed
`archive=1` doorway, not a third right-pane mode. The overlay is scoped only to
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

The console list is the mutable home of its session forest ([[session-nesting]]). The forest panel attaches the
same `inertChromePress` capture boundary as the rest of the console chrome, and registers the shared window
keyboard service walk for its visible rows; the finding dock uses that same resolver for its projection. Dragging a row moves a
full-row ghost, dims the original, and highlights a valid receiving parent; a nested row additionally exposes
a top-level drop zone. The ghost is the same console tree-row presentation as its source, derived again from
the current forest item rather than from a hand-copied appearance record: selection reveal, headline line boxes,
right-side status marker, nesting lead, and fold pod therefore retain their exact internal layout. To keep a
selected row's expanded headline readable without covering the receiving object, the pointer-owned ghost
is rendered at **75% of the source's visual size**, with its pointer anchor adjusted for that scale. Only the
wrapper's semantics differ — the source is an interactive button while the pointer-owned ghost is inert.
The gesture is deliberately ordinary pointer drag rather than a tiny dedicated handle: the row itself is what
will move, so the feedback must visibly be that row. Right-click keeps the complementary
explicit `remove from parent` action for a nested row. Both paths call the one reparent endpoint and leave
selection, terminal focus, and invalid/no-op drops alone.
Dropping a working row on the visible archive zone heading instead performs the row's one reversible `close` transition:
the row leaves the working board and enters the archive in the same gesture. This direct placement has no confirm;
close remains one action here because its retained record, branch, transcript, and archive ref make it reversible.

The [[dock-modes]] sessions projection remains the desktop's at-a-glance finding list. The routed Sessions
document also mounts the same `SessionConsoleTreeRow` forest as its complete mutable list; the terminal or
timeline occupies the remaining content width. The document owns explicit row multi-select and the bulk close
bar, while row movement uses the full-row tree gesture. Graph marquee selection is never a substitute for
session selection.

The row order is **automatic** — the zone grouping above, newest-first within a zone — with no manual
drag-to-reorder gesture. Selection walks the visible rows, and switching sessions never steals a typing sink:

List navigation lives at the **window level** only when focus is outside xterm and every text input.
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
chord — it belongs to [[side-nav]]'s app-global ⌥ command family (⌥N / ⌥F), which the console's
key handling deliberately **falls through unhandled** so the window-level handler
routes it and tmux never sees `M-n`/`M-f`. The reserve holds exactly the chords the shell still claims, so
it shrank with them: the positional ⌥-digit page row is gone ([[keyboard-nav]]) and ⌥+digit is ordinary
console input again, forwarded like any other unclaimed key. (The family is ⌥-based for the same hard browser limit
that shaped the old chord: **⌘/Ctrl shortcuts remain native/browser-owned**, while ⌥ is the modifier the app
can actually own.) 

**Every zone head is the same designed row.** A count pod outlined in the zone's own hue, the label, then a
hairline that runs off the label to the panel edge — a rule that stops at the text reads as a heading, where a
full-width divider would read as one more row. The foldable heads (offline, archive) always had that row while
the working zones printed a bare word, so the list carried two kinds of heading at once; the pod is the zone's
whole population, which the forest already computes for every zone, folded or not.
