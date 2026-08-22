---
title: tab-strip
status: active
hue: 215
desc: Several documents open at once — the address grammar in the plural, not a second navigation model beside it.
code:
  - spec-dashboard/src/tabs.js
related:
  - spec-dashboard/src/tabModel.js
  - spec-dashboard/src/tabModel.test.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/EmptyView.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

**The strip holds objects and singletons.** An OBJECT tab is an address with a selector: `#/spec/<id>`,
`#/file/<path>`, `#/sessions/<id>[?surface=…]`, `#/evals/<node>/<scenario>`, `#/issues/<id>`. A SINGLETON
tab is a bare board — `#/evals`, `#/issues`, `#/settings` — a place the reader keeps open rather than one
they bounce off. It is a tab like any other, closable like any other; "singleton" is not a second tab kind
but a consequence of the identity rule: the address carries no selector, so opening it twice is opening the
same address twice, which the strip already resolves to one tab. The rail button is therefore
create-or-focus without needing to know it is ([[side-nav]]).

**A singleton board is RESIDENT, and residency belongs to the address.** A board never takes the current
slot: it is a place, and a place is not something the reader spends the slot on. This is the other half of
"singleton", and leaving it out cost exactly what the whole-address reasoning predicts — a board reached by
an ordinary navigation (the status-bar tally, a pasted link) sat in the slot, so its own first row click
replaced the list with the detail. The reader asked to read one scenario and lost the list they were
reading it from. The rail button used to hold the board by hand, which made residency a property of that
button rather than of the board; every other door got the slot. [[view-registry]] answers residency for the
address (`resident`, and only while the address carries no selector), so no door has to remember. The
DETAIL addresses of those same pages are ordinary objects and land in the slot like everything else.

What the strip does NOT hold is what has neither an object nor residency: `#/graph` (including
`#/graph/<node>` focus — a legacy address, [[node-graph]]), bare `#/sessions`, and **`#/sessions/new`** —
the launch page names no session, it is where one is STARTED, and a tab for it is a tab for a form. The
session it launches becomes a tab the moment it has an id, which is the moment there is an object to hold.
This is why the strip is empty on a fresh `#/sessions` load and why typing the graph's address mints
nothing.

**The strip is the workspace itself, so it is on every route.** Even where the sidebar is gone — a board
tab has none ([[dock-modes]]) — the working set stays visible and one click returns to it: *"应该被保留的是
各个 tab，各个 tab 才相当于是工作区，而不是左侧边栏。"* The left rail is a way to change destination and the
dock only describes the current tab; the strip is what you are working on, and none of the three is
interchangeable with another.

**A tab is a route.** That is the whole design, and it is why this is not a new navigation mechanism: the
address layer already carried `page + param + query` and already made every destination copyable and
Back-navigable. Opening several at once is that grammar in the plural. A tab click calls the same
`navigate` a link does, so the two can never disagree about where they lead.

**The split of truth follows what workspace editors settled on.** The OPEN LIST is a local layout
preference — it survives reloads, it is not worth putting in a link, and two people opening the same
address should not inherit each other's tabs. The ACTIVE tab is the URL. So every address stays exactly as
shareable as before. The strip renders from the first tab: it is where the current document's NAME lives,
and chrome that only appears when a second document exists would jump the layout at exactly the moment of
the reader's first hold.

**The row is always there, and it always says something.** On the routes that mint no tab — the graph, the
sessions launch page, the empty workspace — the strip names the PLACE instead: the same projection the
document title uses, drawn quiet, because orientation is not a title. This is what makes the row honest
rather than reserved: the shell used to hold the space with a wrapper that drew a blank band on exactly
those routes, which is a band that says nothing while costing the budget the same as one that does.

## a new tab is a gesture, never a side effect

> "弹新 tab 几乎得是个用户没有准许就不存在的行为，除了极少数情况。要思考什么是 tab，什么不是。要思考
> 什么时候是替换当前 tab，什么时候是新开。"

That is the law, and everything below is its mechanism. **The strip holds one CURRENT SLOT plus whatever
the reader explicitly held.** Ordinary navigation — any plain click on any finding row, any link inside a
document, any address typed — lands in the slot and replaces its address. The slot keeps its position, so
the strip does not reshuffle under the reader. A tab is born only from this whitelist:

1. ctrl/⌘-click on a row;
2. a double-click, on a row or on the slot tab itself;
3. a document's own explicit "open in a new tab" action — including a review row's context menu;
4. a deep link into a workspace that has no slot yet;
5. arriving at a RESIDENT address (a singleton board), which is held by what it is rather than by a gesture.

Everything else reuses the slot, **regardless of what kind of document it is**. That last clause is the
correction. The rule used to be fenced by TYPE — only `spec` and `file` could be replaceable, sessions and
board details were always resident — and the fence was defended as a capability argument (a type that
cannot be a preview cannot be displaced). What it actually produced was a strip that filled itself:
clicking three session rows in the dock left three tabs, and opening any resident document while browsing
PROMOTED the preview first, so a reader who clicked around had a working set of things nobody decided to
keep. A protection that mints tabs is not protecting the reader.

**What replaced the type fence is a smaller pair of guarantees**: a pinned tab is never passively replaced
(only its own close button removes it), and a session's persisted default face can only ever be a BASE
surface ([[session-surface]]), so a session re-entered after its slot moved on comes back to a face that
exists. A session document survives replacement for the plain reason that its state is not in the browser:
tmux holds the terminal, the backend holds the transcript. Unmounting a view is not losing work — which is
why the old fence was buying safety that was never at risk.

| gesture | result |
| --- | --- |
| plain click / plain navigation | the slot takes that address (or one slot is opened if none exists) |
| ctrl/⌘-click | a new pinned tab |
| double-click (row or tab) | pin — the slot becomes held, or the row opens already held |
| close | that tab only; the slot is nothing special to close |

The pin mark is an ADDRESS, not a flag, and the strip's own route subscription reads it — so finding
surfaces never touch strip state, and two subscribers of the same navigation (the strip and the session
console both read the open list) resolve the same answer. The object-only registry still means a bare list
route, `#/graph`, or the sessions launch page never creates a tab.

**The semantics are a pure function** (`tabModel.js`: `placeTab`, `normalizeTabs`), separate from the hook
that owns storage and the route subscription. The law above is therefore checkable without a browser, which
is what the previous version lacked when it drifted: five plain clicks must leave exactly one slot, and a
pinned tab must survive them all.

**Identity is the canonical hash.** Two routes that print the same address *are* the same tab, so
re-opening an already-open document activates it instead of stacking a duplicate, and nothing has to dedupe
by hand. The current address is always in the strip — by replacement or by keep — because a strip that
claimed to show what is open while the reader looked at something absent from it would be lying.

**The slot is visibly italic and weakened.** It is still a real route and can be copied, reloaded, closed,
or pinned; the visual treatment names its replaceable status without inventing another tab kind.

**Closing hands focus to the right-hand neighbour, else the left.** That is the rule every editor uses, for
the reason every editor uses it: the reader's eye is already where the closed tab was.

**Closing the LAST tab yields the explicit empty state**, `#/empty` — not a substitute document. Closing
used to navigate to the graph: a gesture that asked for nothing put a document on screen, and the board
appeared to surface from underneath the reader's own work, which is the disorientation this rule exists to
remove. An empty workspace is a real state and it says so — the frame stays whole (rail, dock, status
bar), the content area names the state, and it offers the ways back into a document: search and the
explorer. There were three, and the third was the graph; it left with the graph's retirement from the
workspace ([[node-graph]]), because a door here has to lead somewhere the workspace still sends people.
`empty` is an ADDRESS so the state can be landed on, reloaded and left, but it is not a
document ([[view-registry]]): a tab for it would be the one address that contradicts the strip it sits in.
Only closing the last tab mints it — a fresh load with no tabs opens `#/sessions`, because starting with
nothing held is not the same event as putting your last document down.

`settings` used to be described as a destination people bounce off, and was therefore kept out of the
strip. Two things were true at once and only one of them was the reason: a strip that filled with *visits*
would stop being a list of what you are working on — but that is what the current slot solves, for every
kind of address at once. Settings is a singleton tab now, held when it is asked for by name and closed like
anything else.

**Labels come from the board's own projections** — a node's title, a session's headline plus its i18n face
suffix — never from a
second lookup table that could drift from them. A tab for a node carries the same four-state dot its tile
does, so the strip speaks the board's vocabulary rather than inventing a tab-specific one. When a selector
resolves to nothing (a node deleted, a session closed elsewhere) the raw selector shows: an address that
names nothing is still the address the reader typed, and blanking it would hide that.

**Two documents at once is the shell's** ([[workspace-shell]]): alt-clicking a tab sends its document to
the second pane. The strip only names the gesture; the pane is workspace state, not a tab.

The row's right edge is the shell-owned [[document-actions]] slot. It is the active document's action projection,
not another navigation surface: changing tabs changes the registered buttons, and a document with no registered
actions leaves the edge blank.
