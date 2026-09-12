---
title: workspace-shell
status: active
hue: 220
desc: The frame — rail, dock, tab strip, content area, status bar — and deliberately nothing else.
code:
  - spec-dashboard/src/Shell.jsx
related:
  - spec-dashboard/src/WorkspaceSurface.jsx
  - spec-dashboard/src/EmptyView.jsx
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/test/keep-alive.e2e.mjs
  - spec-dashboard/src/budgetContracts.test.mjs
  - spec-dashboard/src/ViewErrorBoundary.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/documentActions.jsx
  - spec-dashboard/src/ViewScope.jsx
  - spec-dashboard/src/viewScope.js
  - spec-dashboard/src/statusOwnership.js
  - spec-dashboard/src/viewScope.test.mjs
---
# workspace-shell

The frame, and only the frame. It does not know what a spec is, what a session is, or what any view needs.
It knows there is an address, that an address names a view, and where on the screen that view goes.

## Route ownership boundary

Each shell-owned `ViewHost` provides its view with one read-only `ViewScope`. The scope exposes the mounted
address and active state, plus exactly three runtime-checked intents: `open(address)` replaces the current
route, `hold(address)` asks the workspace to place a document in the second pane, and `ownQuery(query)` updates
the current view's query while preserving its page and selector. The scope dispatches one frozen intent object
to the shell; views never receive the raw navigation or hold callbacks. A `hold` intent names an ADDRESS, so
it joins the working set before it is moved into the held slot — a view cannot mint a second region by
handing the shell a route that no tab stands for.

The mounted-document pool keeps one scope identity per host and updates its address/active snapshot when a
pooled entry changes. Hidden panes are inactive and their intents are rejected without dispatch; unmounting a
host drops its provider with the host. Address and query shapes are validated at the boundary (lowercase
kebab-case page, string-or-null selector, URL-safe primitive query values), so malformed cross-view writes fail
before the route layer. Navigation policy and tab identity remain shell-owned; this scope is an intent channel,
not a second router. The host obtains its route contract from the view registry itself: an intent targeting an
unregistered address is rejected before dispatch, and document/resident predicates remain owned by that same
registry rather than a second shell allow-list. `viewScope.test.mjs` and `viewRegistry.test.mjs` prove the
registry rather than a second shell allow-list. The mobile face follows the same rule: its host passes the
captured route as props, so it cannot create a second global route reader while the desktop shell owns its
`useRoute()` subscription. `viewScope.test.mjs`, `viewRegistry.test.mjs`, and `ownershipBoundary.test.mjs` prove
the validation, atomic intent shape, hidden-pane suspension, unowned-route rejection, and host-only route
ownership.

Every hosted view uses this channel for route writes. Graph and Sessions, including the SessionInterface
mounted beneath the Sessions view, dispatch `open` for page changes, object/resource surfaces, and replace
semantics; address projections are converted to `{ page, param, query }` before dispatch and never call the
global writer. Issues uses `ownQuery` for list state and `open` for doors/details and replacement.
Shell-owned chrome (`Shell`, `Dock`, `SideBar`, `TabStrip`) is the deliberate route-writing boundary for
rail, dock, and tab actions; it is not a hosted view and therefore does not receive a ViewScope. The static
`ownershipBoundary.test.mjs` allow-list makes that distinction executable: view descendants cannot import the
global navigator, while shell chrome remains the one owner allowed to do so.

**The window answers four different questions, and each gets its own region.** This is the hierarchy the
whole shell hangs off, re-derived from what the product is rather than from what the code used to be:

  - **Where is everything? — FINDING, on the left.** The rail is the **top-level board bar** of route anchors
  (`sessions`, `spec`, `issues`, `settings`) whose one light means the current resident board.
  Graph remains an addressable legacy view but is not a top-level rail destination. A separate
  mirrored panel control at the rail top owns only dock open/closed. The dock beside it is one finding
  surface with two projections; projection styling belongs to the dock header, never the route light.
  Looking must be free: browsing a finding surface never grows any state but the camera's.
  **The dock is a property of the focused tab** — both its projection and its existence. A node or a governed
  file brings the explorer. The Sessions surface brings no shell dock at all: it is a complete document that owns
  its own forest and console ([[session-console]]), so a finding dock beside it would only repeat the same list
  under an empty header. Review surfaces and Settings have no dock anywhere in their address family — a detail
  route never inherits the previous Spec/Explorer projection from workspace state, which belongs to document
  routes only. Issues and Settings use the shared workspace/tab strip; Issues omits the
  activity rail while retaining the strip. Spec/file routes keep the Spec rail selection and derive the explorer
  projection. Thus the sidebar describes the working set rather than being a setting maintained
  beside it ([[dock-modes]]). Route links may select a related projection as a secondary action, while the
  dedicated rail panel control alone changes open/closed state.
- **What am I reading? — HOLDING, in the center.** The tab strip is the working set and the route is the
  active tab; everything held is an address — a node, a file, a session, or a resident Issues/Settings board.
  Board detail routes focus their corresponding resident tab.
  **The strip is the workspace itself**: *"应该被保留的是各个 tab，各个 tab 才相当于是工作
  区，而不是左侧边栏。"* The rail is only a way to change destination and the dock only describes the
  current tab; what the reader is working on stays on screen and one click away, on every route. Entering a document from a finding surface follows in place; holding it is the deliberate gesture
  ([[tab-strip]]). With no document focus after closing the last session, the center lands on the explicit
  empty workspace (`#/empty`) and names the ways back in through the explorer/palette. The graph remains an
  addressable legacy view, never a substitute for the reader's close gesture.
- **What surrounds this thing? — CONTEXT, at each region's right edge.** A second region (a document sent
  right), and [[context-dock]]: a spec node's open issues and its version history, handed its own region's
  query so it can mark which version that document shows. Context is about the document beside it, which is
  why it is not a finding surface and not a tab. **A region owns its resting state, and that state is
  closed** — it is closed because opening it costs the spec prose 383px of 575 at 1440: a question about the
  document does not get to spend the document's width until it is asked. The toggle lives in one right-edge
  slot per region and the primary's choice persists: while closed the slot overlays that region's band; once
  open it overlays the context head at the same edge, so opening and folding back are one stationary-pointer
  gesture without replacing or reflowing the button.
- **How is the world doing? — AMBIENT, at the bottom.** The status bar's two ordered arrays; notifications
  land above its right end, never over content. It is a full-window flow row after the app row, so rail and
  optional dock stop at its top edge and the view/context row gets the rest of the height. The bar consumes
  its own `--line-status` height and never covers a view; a terminal's final xterm row fits above it. One-pixel
  `--line` borders own the vertical and horizontal seams, meeting as a T at the lower-left rail junction.
  The content pane is a CARD on the chrome: its lower corners are rounded like the active tab's upper ones
  and the column behind it is the band's own `--panel`, so the document reads as one card standing on the
  chrome from strip to status row ([[tab-layout]]).
  The frame itself is what fills it: the workspace identity
  and the ONE BOARD LEDGER — spec nodes by state, open issues, live
  sessions — is true of the window on every route, so no view may own a duplicate and each group is
  registered here. The identity is one compact project-mark/name button that owns the catalog switcher
  and `/projects` door; the route rail contains no duplicate chip. On a graph address the same buttons acquire graph focus-walk behavior; their visual
  ownership and lifetime remain the frame's. A view contributes only
  facts about the document it is showing. That division is what stopped the bar from emptying when a view
  stopped being where a reader lands; the shape of an item and where it lands is [[status-bar]]'s.

A control belongs to the region whose question it answers, and to exactly one owner there — the dock's
  projection is named in its header, while the permanently mounted rail's mirrored panel control owns dock
  open/closed and exposes `aria-pressed`. The context dock's switch is the one document-owned exception: it
  is painted by one stable right-edge slot: over the tab strip while the dock is closed and over the context
  header while open. The slot keeps one `28px` button instance through the dock's width animation, so the
  same pointer can open and close it without a flash. The dock itself has no second collapse door.

**Each region gets ONE band, and a band is a row that earns its place.** [[ui-state-model]] states the
budget and measures it; the shell's obligation is to have no spacer that stands in for a band it does not
draw. The tab strip is the top band itself, not a wrapper holding it: on every surface but Sessions the strip
renders unconditionally and names the routed place when no document is held, so the row is either a working
set or an answer to where the reader is, and never 29 empty pixels; the Sessions document lays the same strip
out inside the surface it owns, beside its forest ([[session-console]]). A control that belongs to the current DOCUMENT — the context
dock's toggle — is painted by the strip's right-edge slot beside the document actions while the dock is closed.
When the dock is open, that same mounted control overlays the context head's right edge; it does not create
another band, replace the node, or move the pointer's target.

**The window says where it is.** The shell is the only component that reads the address, so it is the only
one that can name the place, and it writes `<place> · <project>` into the document title on every route.
The place is the same projection the tab strip draws: a document's own name, or the routed surface's name
from the shared place list, translated like every other label. Faces without an address to report — the
projects hub, the phone, every pre-board state — keep writing the plain project title; both writing it
would race, and a parent's effect lands last.

**Which session owns the graph is workspace state**, held here beside the dock preference,
because the surface that CLAIMS a session (a row in the finding dock) is never the surface that shows the
claim (the graph). Holding it inside the graph is what forced the graph to grow a session list of its own
just to have somewhere to click. It is not persisted: a lock is a way of looking at the board right now,
not a preference to inherit on the next boot.

## Document actions

The tab row's right edge is the shell's **document-actions slot**. It is a registry, not a second navigation
bar: the active document registers icon actions through [[document-actions]], and the shell renders only the
entries whose document key is the active route. Switching tabs therefore replaces the actions as one atomic
projection; a document that registers nothing leaves the slot empty. Registration and state are split like the
status bar, the registry API is identity-stable, and disposing a registration removes it immediately.

Every action supplies an accessible label and may supply an availability state. An unavailable action remains
visible when the document owns that capability, is disabled rather than hidden, and uses its exact disabled
reason as the tooltip. The slot owns no document content, route parsing, or action semantics; it only invokes
the registered callback and provides the one icon-button chrome for it. A registered popup is positioned by the
slot's action wrapper, so a document can expose a picker without growing an internal toolbar.

**The band does not clip; the tab list inside it does.** A popup hangs BELOW the row, so the row itself must
not be the scroll container — the strip is a 30px box, and a strip that scrolls its own tabs cuts every
dropdown off at 30px, which renders a picker perfectly and shows the reader nothing. The tabs get their own
horizontal scroller inside the band; the actions cluster sits outside it, which also stops a long tab list
from scrolling the document's own controls off the right edge.

**What it replaced was not a component but a missing layer.** The board used to be one ~710-line component
that *was* the graph, with every other page hung off it as a hidden pane and every page's state held in
that one component's body — the session selection, the search palette, the node menu, the camera, the
keyboard mode, all together. That shape decided three things it had no business deciding:

- **reading a spec had to be a popup**, because the popup was a child of the graph;
- **a tab could only switch pages**, because a page was the only unit that existed;
- **a document area had nowhere to live**, because there was no content area — only "the graph, plus some
  hidden panes".

Adding chrome around that model — a status bar, a tab strip, a file dock — produced more things competing
for one screen and still no way to read a spec beside its code. Chrome around the old model is not the new
model, and building three pieces of it before noticing is the mistake this node exists to have corrected.

**The shell is the only component that reads the global address.** A palette pick hands the shell one app
address and whether the reader asked for a new tab — a ctrl/⌘ pick opens that address as its own tab
([[tab-strip]]), a plain pick executes it through [[address-routing]]; the shell does not inspect node/session data or mint
another route. A view receives `{param, query}` as
props ([[view-registry]]). That one rule is the hinge: it is what makes rendering two views at once a
layout change rather than a rewrite, and what stops a view from silently coupling to whichever address
happens to be current.

## the mounted-document pool

**Switching tabs does not reload the document.** Views used to be keyed on the address, so leaving a
document unmounted it and returning ran its whole boot again — which is what *"为什么每次点击一个顶上打开
的横 tab 都要重新加载"* was naming. The shell keeps a bounded pool of **mounted** documents (six, sized to
the strip's usual working set) and shows one: the rest are `display:none`, not unmounted, exactly as the
session console has always kept its terminals ([[session-console]]'s warm layers). Only exceeding the bound
unmounts anything, and then it is the least recently shown.

Three properties make that safe rather than merely fast:

- **Render order is insertion order, never recency.** Reordering keyed children moves real DOM nodes, and a
  moved node re-attaches its iframes and canvases — a reload wearing a different name. Recency lives in a
  counter used only to choose which entry to drop.
- **A pane knows two things a view cannot work out for itself once it can be hidden**: the address THIS
  pane holds — which is not the window's address while it is hidden — and whether it is the one showing.
  Anything keyed per address (a scroll position, [[page-scroll]]) keys on the pane, or a hidden pane writes
  its state over the visible one's. A hidden document holds no keyboard scope ([[keyboard-service]]) and
  does not fetch: it is kept WARM, not busy.
- **A hidden pane does not re-render.** The shell re-renders on every board push, so the pool is memoised
  per pane AND a hidden pane reads the board it was hidden with. Either alone does nothing — a subtree
  re-renders if props or context moved — and together they are what stops an idle workspace from costing
  more the more tabs it holds. A pane catches up in the render that reveals it.

**What is "the same mounted document" is per view, not per address.** Most views are one per address. Two
are one per PAGE: the graph, whose camera and expansion are the workspace's state rather than one address's,
and the session console, which holds every live terminal's socket and scrollback — keying it per session id
is precisely what made every session switch a cold boot. Those two receive their object as props and follow
it, which the console already did for its own list.

The SECOND pane is not a pool: it holds one document the reader deliberately sent there, so keying it on
the address is the whole contract.

Measured with six documents mounted (`test/keep-alive.e2e.mjs`): a document's own DOM node survives a round
trip through two other tabs, **every** warm switch lands under the 0.25s red line — 0.073s, 0.029s, 0.053s,
0.101s including the return to the session console — and the pool costs **0.006 seconds of script per 10
idle seconds**, 0.013s with a live session console hidden among them, whose cost is terminal output arriving
rather than the pool.

**The return to the session console was the one measured exception, and it was never the pool's hiding.**
That switch used to cost ~0.5s, and the long task inside it was laying out the console's terminal rows the
moment they were rendered again — ~4,500 row elements across the console's warm layers. Three hidden states
were measured against exactly that switch and none of them moved it, which was the first useful result:
`display:none` paid ~0.5s on return; keeping the box laid out (`position:absolute` + `visibility:hidden`,
the pattern the console uses internally) paid ~0.31s on EVERY switch instead, because the dock's width
follows the focused tab so the box changes size while hidden and re-lays those rows out each time;
`content-visibility:hidden` restored the other switches but still paid ~0.37s on return. A property that
takes a subtree out of rendering cannot make rendering it again cheap. So the pool keeps `display:none` —
the cheapest of the three everywhere it differs.

The second useful result is that **the row count was not the reader's accumulated terminal**. It was warm
terminals mounted for sessions that no longer existed: the console's mount gate read an archive-index row's
missing liveness as alive, so 66 of the 76 mounted xterms — 4,290 of the 4,940 row elements, and 66 live
WebSockets — belonged to closed sessions. Deciding the row count is [[session-console]]'s warm-layer
contract, and it now decides it by asking for a live pane; this switch costs **0.101s**.

**A crash is contained to the pane it happened in.** Each viewhost and the dock render behind their own
error boundary, so a view that throws leaves the rail, the tab strip, the status bar and the other region
rendering exactly as they were — a reader who can still navigate can still get out. The boundary
resets on the address it is keyed by: leaving a broken document is the natural recovery and must not cost
a reload, and the panel's retry is that same reset for when the address did not change. The console keeps
the stack; the pane shows one line. Wrapping the whole app instead would trade a broken document for a
white screen, which is the failure this exists to prevent. The other half of the same contract is the
stale dist: a lazy chunk that 404s after a redeploy retries twice, then reloads the page once (guarded, so
it can only happen once per tab) before surfacing here ([[view-registry]]).

**The sealed public face gets the frame's smallest form**: no dock, no tabs, no palette, one view, but it
still mounts the frame's bottom ambient status bar. The public About disclosure is registered there, so the
static graph's release facts have a real visible owner instead of a provider entry that can never paint. A
door that is not built is shut more firmly than a door that closes itself, which is why that face no longer
redirects away from live addresses — it never renders one.

**Two documents at once is a layout, not a rewrite** — and that is the whole return on the hinge. A second
document is a second route and a place to put it; not one view changed to make it possible, because a view
was already receiving its route rather than reading it. A reader sends a document right by alt-clicking its
tab or through the tab menu: they are already pointing at the document they mean, so the gesture asks for no
new vocabulary and no new surface.

**A REGION is a place to read a document; it is never a second workspace.** Every region mounts the same
component, which draws three things: the band naming the group it holds, that group's showing document, and
that document's own context dock ([[context-dock]]). Everything else in the frame — the rail, the navigator
sidebar, the status bar, the palette — belongs to the WINDOW and is drawn exactly once, beside every region.
The rule has teeth in one direction that is easy to get wrong: a document that owns page chrome of its own
(the Sessions console's forest, [[session-console]]) draws it only while the workspace is ONE group, so the
pane tells it which kind of workspace it is in. A second region that rendered a PAGE where it should render a
DOCUMENT is what painted a second strip listing every tab, a second navigator, and two navigators folding
together because they read one flag.

**The workspace is a TREE of regions, and the layout is that tree drawn.** A group is a region; a split is
two subtrees sharing one box at a ratio the reader drags, with one divider between them — [[tab-strip]] owns
the tree, this node only lays it out. Splitting again inside either side is the same box again, which is what
makes a grid out of one rule: the shell needs no case for "two panes" and none for "nine". The ratio lives on
the split node, so the arrangement survives a reload and a window resize together; a pixel width on a node
that comes and goes as the reader splits and collapses would survive neither ([[resizable-panes]] keeps the
pixel mechanism for the frame's own fixed panes).

**Working in a cell is clicking in it.** Focus follows the CLICK rather than the press, so the click that
moves focus still reaches whatever it was aimed at — a close control in an unfocused cell closes its tab on
the first click instead of spending it on the cell. A right-click never moves focus: it is asking a tab a
question, not choosing where to work. The focused group is the one whose document the address bar names
([[tab-strip]]), which is also what keeps a reload landing where the reader left off.

**A region sits BESIDE its sibling or UNDER it, and the verb names the side.** The tab menu offers both moves
— split right, split down — and the window remembers which was used last, so the next split and the alt-click
gesture land the same way. The labels name a DIRECTION rather than an axis on purpose: "horizontal" and
"vertical" name opposite arrangements in an editor and in a terminal multiplexer, and a reader should not
have to know which convention this window picked.


**Each region answers context for its own document.** The dock a region draws describes the document that
region holds — two spec nodes held side by side get two docks, each with its own node's issues and history —
and the region owns the open/closed state its toggle flips, at its own right edge. The primary region's
choice is the persisted habit; the held region starts closed, so a document sent right never spends the
other document's width until the reader asks it to.

Measured with two live spec documents open: 0.02 seconds of script per 10 idle seconds.

**The palette is the shell's**, not a view's, because it floats above whichever view is showing; a hidden
view must never be able to swallow it. The dock toggle and the project identity are the shell's for the
same reason: they are true of the window, not of what it currently displays.
