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
  - spec-dashboard/src/subtractive-boundaries.test.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/FileTree.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/styles.css
---
# tab-strip

## Anti-regression boundary

Resident Evals and Issues details keep their detail address in the URL while their tab identity remains the
single top-level board address. The empty workspace remains an explicit `#/empty` route backed by `EmptyView`;
it is not replaced by the graph when the last document closes. The executable boundary test covers these
subtractive and resident-tab invariants alongside the pure tab model.

**The strip holds the workspace working set.** Object tabs include `#/file/<path>` and `#/sessions/<id>`.
Spec, Evals, Issues, and Settings are resident top-level tabs (`#/spec`, `#/evals`, `#/issues`,
`#/settings`); opening a spec node, scenario, or issue keeps its detail address in the URL while focusing
that surface's top-level tab. A file or session detail never replaces another kind's resident/document tab.
A session's
`?surface=conversation|terminal|diff` is internal view state on that one session object, never part of tab
identity or deduplication. A `resource:…` face is the exception: it is a file-class workspace tab with its
own identity, appended beside the unchanged session tab. The rail navigates into this same working set and
does not own a second focus state. Graph remains the one addressable view that never becomes a top-level tab.

Resident Spec, Evals, Issues, and Settings tabs render the page icon declared by [[view-registry]], the same
identity their activity-rail entries use. A detail URL keeps that resident tab identity while its node,
scenario, or issue selection remains route state. A board's list tabs (for example Open/Closed) are view-local
filters, not workspace addresses. SpecView still owns the `#/spec/<id>` detail address, and file chips still
open independent `#/file/<path>` document tabs.

What the strip does NOT hold is what has no object: `#/graph` (including `#/graph/<node>` focus — an
addressable legacy view, [[node-graph]]), `#/empty`, bare `#/sessions`, and **`#/sessions/new`** —
the launch page names no session, it is where one is STARTED, and a tab for it is a tab for a form. The
session it launches becomes a tab the moment it has an id, which is the moment there is an object to hold.
This is why the strip is empty on a fresh `#/sessions` load and why typing the graph's address mints
nothing. `#/empty` is the explicit state reached after the last workspace object is closed; it is not a
fresh-boot alias and it never enters the strip.

**The strip is the workspace itself, so it is on every route.** Even where the sidebar is gone — a bare board
has no document tab ([[dock-modes]]) — the working set stays visible and one click returns to it: *"应该被保留的是
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
review/settings boards, and the sessions launch page — the strip names the PLACE instead: the same projection the
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
4. a deep link into a workspace that has no slot yet (for an object document; boards do not qualify).

Everything else reuses the unpinned slot **within the route's page kind**. The two human rules sit beside
each other: "弹新 tab 需用户准许" prevents kind-internal browsing from proliferating tabs, while
"session 不许被 spec 顶掉 / session→session 原位切换" prevents a different kind from evicting the
reader's session and keeps same-kind session clicks in place. One-slot-any-kind satisfies the first rule
only by breaking the second: a spec click can drive out a session. When no unpinned slot exists for the
requested kind, the address is appended as another unpinned slot for that kind; pinned tabs remain held.

**What replaced the type fence is a smaller pair of guarantees**: a pinned tab is never passively replaced
(only its own close button removes it), and a session's persisted default face can only ever be a BASE
surface ([[session-surface]]), so a session re-entered after its slot moved on comes back to a face that
exists. A session document survives replacement for the plain reason that its state is not in the browser:
tmux holds the terminal, the backend holds the transcript. Unmounting a view is not losing work — which is
why the old fence was buying safety that was never at risk.

| gesture | result |
| --- | --- |
| plain click / plain navigation | that page kind's slot takes the address (or one is opened if none exists) |
| ctrl/⌘-click | a new pinned tab |
| double-click (row or tab) | pin — the slot becomes held, or the row opens already held |
| close | that tab only; the slot is nothing special to close |

**A row that is a real anchor gets the gesture, not a rewrite.** Finding surfaces increasingly render their
rows as real `<a href>` — the review lists, the spec context panels, the file tree — because that is what
makes an address copyable, middle-clickable and openable in a browser tab for free. Those rows still owe the
strip its two claimed gestures, so the rule is ONE helper they all call rather than one hand-rolled handler
each: a plain click is left entirely to the anchor (the browser writes the hash, the slot takes it), and
ctrl/⌘ is intercepted into the hold. Shift, alt and middle-click are untouched — the reader asking for a
second document beside the first wants a second tab, while the reader asking for a new window still gets
one. The helper reads the route back out of the row's OWN href, so nothing has to re-derive the address from
the data the row was built from.

The pin mark is an ADDRESS, not a flag, and the strip's own route subscription reads it — so finding
surfaces never touch strip state, and two subscribers of the same navigation (the strip and the session
console both read the open list) resolve the same answer. The object-only registry still means a bare list
route, `#/graph`, or the sessions launch page never creates a tab.

**The semantics are a pure function** (`tabModel.js`: `placeTab`, `normalizeTabs`), separate from the hook
that owns storage and the route subscription. The law above is therefore checkable without a browser, which
is what the previous version lacked when it drifted: five plain clicks of one kind must leave exactly one slot, and a
pinned tab must survive them all. Reading persisted tabs writes the normalized result back once, so retired
review entries are removed from storage rather than merely hidden in memory.

**Identity is the canonical object hash.** Two routes that print the same object address *are* the same tab,
and session surface queries are deliberately ignored: `#/sessions/a?surface=terminal` and
`#/sessions/a?surface=diff` activate the same `#/sessions/a` tab. Surface navigation uses URL replace, so the
face changes without creating, replacing, or reordering a tab. A published file/web resource instead appends a
file-class tab and leaves the session tab and its selected face untouched. The current object is always in the
strip — by replacement or by keep — because a strip that claimed to show what is open while the reader looked at
something absent from it would be lying. This is the regression guard for the human's report: "点进去(diff)之后当前 tab
就废掉了" and "一个 session 的视图可以在 terminal 和 conversation 视图之间切换".

Resources are **pinned holds at birth**. Opening a posted file or web resource is an intentional request to
keep that file-class workspace object; its tab is born `pinned:true`, never competes for the file slot, and
is removed only by its close action. Reload normalization repairs older resource entries to the same hold.

**The slot is visibly italic and weakened.** It is still a real route and can be copied, reloaded, closed,
or pinned; the visual treatment names its replaceable status without inventing another tab kind.

## the order is the reader's, and the strip wraps rather than scrolls

**A tab can be dragged, and the order it lands in is the stored order.** There is no second arrangement to
keep in step with the list — the strip renders the array, so moving a tab is one `splice` and the placement
persists through the same local storage the open list already uses. Two consequences fall out rather than
being arranged: the arrangement survives a reload for free, and a drag *changes nothing else* — the active
document stays active, no address is written, and a release that lands where the tab started writes nothing
at all. **A slot is not exempt.** It is an ordinary entry that happens to be unpinned, found by its kind and
that flag rather than by position, so it may be dragged anywhere and ordinary navigation still lands in it
exactly where the reader put it.

The gesture is the workspace's shared pointer drag ([[drag-gesture]]) and it is deliberately not native
HTML5 drag-and-drop: a tab face is a button, which swallows `dragstart`, and the browser's drop protocol
and ghost image are machinery neither this strip nor the session dock wants. Six pixels of slack keep a
press a press, so click, double-click-to-pin, middle-click-to-close and the context menu are all untouched;
the click the browser emits after a real drag is eaten, so dropping a tab never also opens it. **The mark is
a hairline on the edge the tab would arrive at**, drawn on a tab rather than between tabs — which is what
keeps it correct in any row of a wrapped strip — and it appears only where a release would actually change
the order. Nothing lifts and nothing casts a shadow: the strip stays one plane while its order changes.

**Tabs that do not fit WRAP onto the next row; the strip never scrolls sideways.** This is the one mode.
A horizontal scroller hides the working set behind a gesture — the documents you are holding sit off-screen
with nothing saying so, which is a strip that has stopped answering the question it exists to answer.
Wrapping keeps the whole set legible and pays for it in a thickness the reader can see, and the payment is
self-limiting: the current-slot-per-kind rule means the strip only grows when someone enters another kind or explicitly holds one, so a tall
strip is a working set someone chose. Every row is the same height, and the band's height is therefore the
working set rather than a constant.

**Width has two explicit regimes.** In the normal regime the tab row is `nowrap`: each tab is content-sized,
shrinking toward the 80px minimum when the row overflows, and clamped to a 240px maximum; the active tab keeps a
112px readability floor. The label,
status mark and permanently allocated 24px close control determine the preferred width, and the right edge contains
only that control's normal padding. A short final row therefore keeps its real empty space instead of stretching
short labels into dead chrome. One `ResizeObserver` watches the tablist and adds `.wrapped` only when
`tabCount * 80px > tablistWidth`.

In the pressure regime (`.wrapped`) the verified shrink-wrap rule returns: tabs use `flex-basis: 0`, shrink toward
their minima, and wrap only after the row cannot fit those minima. The tab itself is the inline-size container in
this regime, so the 140px padding and 100px status-mark thresholds remain live per tab. The close control keeps its
24px place in both regimes; hover changes opacity and background only, so moving across tabs cannot resize the row.
The face keeps its full accessible label and tooltip while its visible title ellipsises. YATU evidence records
rendered widths for 2, 5 and 12 tabs in both regimes and verifies that a short label's X right edge leaves only
normal padding to the tab edge.

Every tab owns the same top-corner radius, including the inactive tab while hovered or keyboard-focused. The
tab face and close control clip their own hover/focus washes to the matching left/right top corner, so the
highlight cannot turn into a square patch at either edge. The bottom edge stays square: it is the shared seam
with the content plane, not a floating chip boundary.

**The action cluster sits at the strip's LAST row**, against the content it acts on ([[document-actions]]).
It is a sibling of the wrapping list, not a member of it, so it reserves its own column and no tab can run
under it — an editor needs a measured reserve at the end of the last row only because its toolbar floats
over the rows. With one row this is exactly where the cluster always was; with several it stays put instead
of drifting to the middle of a band that grew.

**A wrapped strip is still ONE band.** Rows are the strip's internal layout, not stacked chrome, and
[[ui-state-model]] counts it once at any height — a model that counted rows would be counting the reader's
open documents as chrome. The budget gate enters every state with a working set deep enough to wrap and
prints the row count beside the band count, so the claim is measured rather than asserted.

**Closing hands focus to the right-hand neighbour, else the left, within the tab's kind.** That is the rule every
editor uses, for the reason every editor uses it: the reader's eye is already where the closed tab was. Session
tabs additionally classify their fallback so a session can never hand focus to the graph.

**Closing hands focus back by document kind.** A spec or file tab closes to the graph backdrop, preserving the
existing reading path. A session tab never falls to graph: the nearest remaining session tab on its right wins,
then the nearest session on its left; when none remains, close lands on the explicit empty workspace `#/empty`.
This is the regression guard for the human's report: "我关掉一个 session 的 tab…直接 focus 到了 node
graph 上面…太诡异了". Other document kinds keep the ordinary neighbour rule. `empty` is an ADDRESS so the state can be landed on,
reloaded and left, but it is not a document ([[view-registry]]): a tab for it would be the one address that
contradicts the strip it sits in. A fresh load with no tabs opens `#/sessions`, because starting with nothing held
is not the same event as putting your last document down.
The earlier human rule "退回到 spec node graph" described spec/file workspaces. The later session-specific
report "我关掉一个 session 的 tab…直接 focus 到了 node graph 上面…太诡异了" narrows that rule: session tabs
use the classified session fallback above, while spec/file tabs retain the graph return.

Spec, Settings, Evals, and Issues are resident documents even though their bare addresses are board destinations
or detail entrypoints;
their detail/query state does not mint another identity. The same resident tab remains selected for a bare
board or any parameterized detail URL.

**Labels come from the board's own projections** — a node's title, a session's headline — never from a
second lookup table that could drift from them. A tab for a node carries the same four-state dot its tile
does, so the strip speaks the board's vocabulary rather than inventing a tab-specific one. When a selector
resolves to nothing (a node deleted, a session closed elsewhere) the raw selector shows: an address that
names nothing is still the address the reader typed, and blanking it would hide that.

**A board's DETAIL is route state inside its resident tab.** Evals and Issues keep the stable page label and
page icon in the strip while the URL carries the selected scenario or issue; Evals may additionally wear the
selected node's status dot, which costs no detail fetch. `#/issues/new` remains a compose route with no issue
identity.

Session conversation, terminal, and diff are not three workspace tabs. They are surfaces of one session tab:
the toolbar exposes one icon-only conversation/terminal toggle and one independent diff action, both using
URL replace so switching never creates, replaces, or reorders the session tab. This is the later single-button
resolution of the earlier request that those faces share the top row.

**A document with no projection names ITSELF.** An issue is the one document the board holds nothing about
— the issues board is paged and the detail fetches its own — so the detail reports the concern it already
loaded and the frame remembers it ([[document-actions]]). That is not the second lookup table forbidden
above: what that rule forbids is a second SOURCE free to disagree with the first, and here there is exactly
one writer and it is the thing being named. The name outlives its document's mount, so a tab does not lose
its label when the pool evicts the document behind it; until the name arrives, the id shows, exactly as an
unresolved selector does.

**Two documents at once is the shell's** ([[workspace-shell]]): alt-clicking a tab sends its document to
the second pane. The strip only names the gesture; the pane is workspace state, not a tab.

**The strip/content boundary is one shared `--divider-rule` seam.** The strip supplies the panel ground and the
content host owns the single top rule, so the active tab's paper plane meets the document without a second
tab-local border or a layout jump. Group headings elsewhere in the frame consume the same rule mechanism.

The row's right edge is the shell-owned [[document-actions]] slot. It is the active document's action projection,
not another navigation surface: changing tabs changes the registered buttons, and a document with no registered
actions leaves the edge blank. A session with more than one available face registers one three-state segmented
switcher there — conversation, terminal, diff — with terminal/diff omitted when the session is headless or
offline; a single-face session hides the switcher entirely. The selected face is the only highlighted segment;
each press replaces the session surface URL and leaves the session tab count unchanged.
The tab itself shows only the session name and status dot, never "· terminal" or "· diff". The reader's words
remain the test: "为什么要在 tab 上去写 terminal 这种东西" and "一个 session 的视图可以在 terminal 和
conversation 视图之间切换,这是存在很长时间的功能,怎么能就这么消失了".
