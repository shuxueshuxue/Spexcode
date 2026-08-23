---
title: dock-modes
status: active
hue: 210
desc: The left finding dock's explorer and sessions projections, selected by the rail.
code:
  - spec-dashboard/src/Dock.jsx
related:
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/sessionListState.js
  - spec-dashboard/src/styles.css
---
# dock-modes

The dock is one finding surface with two projections: **explorer** finds governed files and spec nodes;
**sessions** finds active sessions.

The explorer itself discloses two SECTIONS — the spec tree ([[file-tree]], open by default) and the real
directory tree ([[disk-tree]], closed). That is not a third projection: a projection decides what the dock
is FOR right now and is chosen from the rail, while a section is a disclosure inside the one list the
explorer already is. The distinction survives the band rule below because a section head owns its own
disclosure control and scrolls with its list, so the dock is still exactly one band with either section
open, both, or neither.

**The sidebar is a property of the focused tab, not a setting the reader has to maintain** — both which
projection it shows and whether it exists at all. A session document belongs with the session list; a node
or a governed file belongs with the explorer. **Bare evals, issues and settings boards have no sidebar,
while their object details retain the dock.** A bare sessions route is not a session document and starts
with explorer on a cold workspace. Projection selection is secondary state: graph and sessions route links
may select explorer or sessions, but the rail light remains route-only. The dedicated mirrored rail panel
control is the only open/closed owner, and clicking the active route is idempotent. Explorer rows retain
[[file-tree]]'s route behavior. Session rows reuse [[session-row]]'s projection and follow [[tab-strip]]:
a plain click navigates to `sessions/<id>` in the current slot, while ctrl/⌘-click or a double-click holds it
as its own tab.

**The dock closes from the dedicated rail panel control, and the closing is a movement.** The permanently
mounted mirrored rail button is the one open/closed door and reports `aria-pressed`; the dock header carries
projection doors only. Opening and closing slide with one shared `--dur-panel` token rather than a duration
invented per panel, and the element outlives the state that
hides it by exactly that long so the reverse is visible too. The animated property is max-width: the dock's
width is the reader's own inline resize, and a keyframe cannot outrank an inline style — `!important`
inside a keyframe is ignored by the spec, which is how the first version of this animated nothing at all.
Reduced-motion drops the animation and keeps both doors.

**THE DOCK IS ONE BAND.** One header row serves both projections: the projection's name in sentence case,
its tally, and the doors that projection owns. Switching projection changes what the dock LISTS, never how
thick the dock is — which is the [[ui-state-model]] budget made structural rather than remembered. A
projection may not mint a strip of its own. **Historical:** the explorer count row, sessions `+` row, and
archive door were once three separate strips stacked around one list; that arrangement is retired in favor of
this single header row.

The header and zone tallies are last-good projections during a backend outage. They stay visible for context
but carry the same translated `stale` marker as the status bar until the shared transport proves reachability
again; the dock never paints an old count as silently current and never invents a replacement zero.

**SEARCH IS ONE OF THOSE DOORS, and each head opens it on what that head LISTS.** The sessions head searches
sessions; the explorer head searches nodes. It is the same palette either way — same rows, same keys, same
matcher — and the projection only sets which plane leads ([[paged-palette]]'s `boost`). **Historical:** search
used to be a rail button ([[side-nav]]) that had to guess a scope above both projections. That button is retired;
sitting inside the head row, the current door needs no answer — the row it is in has already given
one. The keyboard follows the same rule rather than a second one: `/` opens the palette on the projection in
force, so the key and the visible door can never disagree.

The dock's session projection is the **one full session list** in the desktop window. It consumes the board's active
session set through `sessionForest`, including zone headings, nesting rails, fold pods, status glyphs, and the
route-selected highlight (`activeSessionId`). `sessionForest` and each row consume the same `sessionDisplayState`:
the status published by `/api/sessions` is ground truth. `asking`/`review`/`done`/`close-pending`/`error` form
needs-you; `working`/`queued` and other active values form running; `offline`/`retired` form offline; archived
records form the fourth archive zone and use the muted archive mark (`○`). Liveness never overrides the status,
so a dead review or asking session stays in needs-you with its lifecycle glyph. Parentage follows the stored
relationship across all status zones: a child never leaves its parent. **Glyph ≡ the session's own status; zone ≡
the family's root status.** Each zone header counts every member of that zone (root plus all descendants); folding
the family changes visibility, never the count. The header's `+` navigates to `sessions/new` and its archive
door navigates to the sessions document's archive overlay. Both are finding-surface doors, while the archive
overlay and all session content remain in the holding region. A CLICK on a row is navigation and nothing
else: plain click replaces the current tab and ctrl/command-click holds a new one. Moving a row is a
separate gesture with its own section below, and it changes no address.

Every zone heading uses the shared `--divider-rule` hairline for its trailing separator. The zone hue remains
on the label and count pod, where it carries status meaning; the boundary itself has one token and one weight,
matching the explorer's section heads and the tab/content seam.
When a session document is focused through a tab, palette, or direct route, the dock reveals its parent chain and
keeps the route-selected row visible and highlighted. An active row in the folded offline zone opens that zone as
well; the reveal is derived from `activeSessionId`, not a second selection state.

The human ruling for cross-zone nesting is owned by [[session-row]]: it restores the parent relationship as the
only nesting input and rejects both the old cross-zone split and the upward parent link. This dock follows that
rule while keeping each child's own glyph.

**A session row is also where the graph is claimed.** Alt-click scopes the board to that session's worktree
— its nodes stay lit, every other node dims, and [[lock-hint]] names the claim. The row wears the claim
while it holds. The graph's own cross-reference is only the bounded collapsed badge described by
[[node-graph]] and [[session-picker]], not a second full list: the claim belongs beside the sessions, and the
lock itself is [[workspace-shell]] state so the two surfaces need not know about each other.

**Right-click on a session row opens that session's own menu** — rename, tmux attach, lock on graph, close —
the same menu the selected session's document tools open from the actions slot. One menu, two ways in: the
dock reaches ANY row, the actions slot reaches the one you are reading. The menu moved here with the rows
when the console's own list was withdrawn; for one release it did not, and the rows carried a click and
nothing else, which left rename and attach with no pointer route anywhere in the window. A finding row
being a menu's anchor is not mutation state living in the dock: the row still only navigates, and every
action the menu offers is performed by the menu.

Archive, close, and resume actions remain document-side; rename remains reachable from the selected session's
document tools. Multi-select stayed retired with the list that owned it. The existing keyboard fresh-session
binding remains active.

## a row can be MOVED, and that is not navigation

**Dragging a session row is how a session is moved, and it belongs wherever the sessions are listed.** It
was withdrawn with the old list on the reasoning that the dock's finding projection must not grow mutation
state — and that reasoning was one word too broad. What a finding surface must not grow is a second place
where a session's *state* is decided; where a session SITS is not its state, it is the shape of the list
itself, and a list is the only surface that can express a move at all. Withdrawing the gesture did not move
it somewhere better, it deleted it: there has since been no pointer route anywhere in the window for
"put this session under that one". Right-click already proved the shape — the row is a menu's anchor without
the dock owning what the menu does ([[session-row]]) — and a drag is the same bargain: the dock says WHERE,
the existing backend call does the moving.

Three landings, and each is a place that was already on screen:

- **Onto another row** — that row becomes the parent. Three landings refuse themselves and read as no
  landing at all: a row onto itself, a row onto a descendant of its own (which would make a cycle out of a
  tree), and a row onto the parent it already has.
- **Into the list's own GAP, below the rows** — out of the subtree, to the top level. A tree has nowhere to
  point at "no parent", so the empty space answers for it, and the list outlines itself while a nested row
  is in hand. The outline is deliberate and so is what it replaced: the first version inserted a dashed
  strip at the head of the list when a drag began, which pushed every row down by its own height at the
  exact moment the reader was aiming at one — the row they were reaching for moved out from under the
  pointer. An affordance for a move must not itself move anything.
- **Onto the ARCHIVE DOOR in the header** — the same door that opens the archive takes what is dropped on
  it. One door, one meaning ("where filed sessions go"), reached two ways; a separate drop strip would be a
  second answer to a question this button already answers. It arms itself while a session is carried and
  goes hot in the danger accent when the session is over it, because the drop removes a worktree.

**A drop on the archive door asks the SAME confirm the menu's close asks** ([[session-rename]]'s menu). The
removal is identical, so it is one prompt with two openers rather than two prompts for one destruction —
two dialogs is two places for the wording, the danger styling and the background-removal semantics to
drift. That a drag is a more deliberate gesture than a right-click does not make the removal less
destructive.

The pointer behaviour is the workspace's shared gesture ([[drag-gesture]]): six pixels of slack, so click,
double-click-to-hold, alt-click-to-lock and the context menu are all untouched, and the click the browser
emits after a real drag is eaten so a drop never also navigates. The move itself is the backend's existing
reparent for both directions — the top level is the parent `null`, which is what it already was in the
record, so there is no second notion of "detach" anywhere.
When the dock is in sessions mode, `SessionInterface` renders no `si-list`, board scrollport, list resizer, or
48px stub: the terminal or timeline owns the entire document content region. This is the [[workspace-shell]]
four-region model made literal — FINDING on the left, HOLDING in the center, CONTEXT on the right, AMBIENT at
the bottom — so one window cannot expose two competing navigation lists.

The dock mode is not a second navigation model and the DOCK does not read the global address: the shell
derives the projection from the focused document and passes it down, exactly as it passes the board data.
Whether the dock renders is therefore two facts and not one — the reader's open/closed choice, and whether
the focused tab has a sidebar at all ([[ui-state-model]] counts the band from exactly those two). Beneath that
header, the dock renders content only — the tree, or the session forest. There is no dock modebar.

**Its resting width is a margin, not a column.** The dock opens at 200px and will not be dragged below
160px: wide enough that a session headline or a file name reads before it ellipses, narrow enough that the
finding surface stays beside the document rather than competing with it. A reader who wants more drags it
and that choice is what persists, so the default only decides what an unopinionated window looks like.
