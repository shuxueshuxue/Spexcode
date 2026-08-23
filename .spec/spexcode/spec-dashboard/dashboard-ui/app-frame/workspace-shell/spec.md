---
title: workspace-shell
status: active
hue: 220
desc: The frame — rail, dock, tab strip, content area, status bar — and deliberately nothing else.
code:
  - spec-dashboard/src/Shell.jsx
related:
  - spec-dashboard/src/WorkspaceSurface.jsx
related:
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/test/keep-alive.e2e.mjs
  - spec-dashboard/src/ViewErrorBoundary.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/documentActions.jsx
---
# workspace-shell

The frame, and only the frame. It does not know what a spec is, what a session is, or what any view needs.
It knows there is an address, that an address names a view, and where on the screen that view goes.

## Ownership: contributions are licensed by the parent

Every UI element has exactly one **parent**. A child may contribute only through the channel its parent exposes;
there is no ambient right to reach across the tree and write into another surface. Shared chrome — status-bar
items, document actions, keyboard authority, the search palette, and transient notifications — accepts
contributions only through the active `ViewHost`'s typed `ViewScope` channel. When a view is not the active route,
its contributions are automatically suspended; when its host unmounts, the scope is revoked and every contribution
is disposed. A component that is not the parent therefore cannot construct a contribution into someone else's
surface. The double-status-bar incident is the reason this is a mechanism contract: *不可能允许非 parent 的组件随意塞东西*.

Navigation has one authority. Only the route/tabs layer may mutate the address. A view requests a typed intent —
`open`, `hold`, or `own-query` — and the route/tabs owner decides how that intent changes the current slot, held
documents, or query state. A view cannot write another view's address, replace another view's content, or smuggle
a cross-view navigation through a shared callback; those operations are structurally unavailable outside the
navigation owner.

A view renders only inside its own `ViewHost` subtree. It may not mount content into a sibling host, the shell's
chrome, or another view's document region. Overlays are the shell's authorized layer: a view asks the shell for an
overlay through its parent scope, and the shell owns placement, stacking, dismissal, and focus return. This keeps
overlay escape hatches explicit while preserving the same one-parent rule for transient surfaces.

**The window answers four different questions, and each gets its own region.** This is the hierarchy the
whole shell hangs off, re-derived from what the product is rather than from what the code used to be:

- **Where is everything? — FINDING, on the left.** The rail is an **activity bar** of route anchors
  (`graph`, `sessions`, `evals`, `issues`, `settings`) whose one light means the current route. A separate
  mirrored panel control at the rail top owns only dock open/closed. The dock beside it is one finding
  surface with two projections; projection styling belongs to the dock header, never the route light.
  Looking must be free: browsing a finding surface never grows any state but the camera's.
  **The dock is a property of the focused tab** — both its projection and its existence. A session document
  brings the session list, a node or a governed file brings the explorer. Review and settings routes are
  separate surfaces: they bring their own board/page layout and no workspace sidebar, taking the full width
  instead of inheriting the tree the last tab was showing. Review details are not workspace documents. A bare
  sessions route is not a session document, so a cold workspace defaults to explorer; only a session object
  route derives sessions. Thus the sidebar describes the working set rather than being a setting maintained
  beside it ([[dock-modes]]). Route links may select a related projection as a secondary action, while the
  dedicated rail panel control alone changes open/closed state.
- **What am I reading? — HOLDING, in the center.** The tab strip is the working set and the route is the
  active tab; everything held is an object document with an address — a node, a file, or a session. Evals/issues
  boards and their details are review destinations, not workspace documents or tabs; Settings is its own surface.
  **The strip is the workspace itself**: *"应该被保留的是各个 tab，各个 tab 才相当于是工作
  区，而不是左侧边栏。"* The rail is only a way to change destination and the dock only describes the
  current tab; what the reader is working on stays on screen and one click away, on every route. Entering a document from a finding surface follows in place; holding it is the deliberate gesture
  ([[tab-strip]]). With no document focus the center lands on the graph bottom sheet (`#/graph`) and names
  the ways back in through the explorer/palette; the graph is the hidden tab the human explicitly retained,
  not a document substitute.
- **What surrounds this thing? — CONTEXT, on the right.** The second pane (a document sent right), and
  [[context-dock]]: a spec node's scenarios and open issues. Context is about the current document, which is
  why it is not a finding surface and not a tab. **The frame owns its resting state, and that state is
  closed** — the shell reads the preference, so the default belongs here rather than inside the dock that
  would be arguing for its own existence. It is closed because opening it costs the spec prose 383px of 575
  at 1440: a question about the document does not get to spend the document's width until it is asked. The
  toggle rides the tab strip's trailing cluster and the choice persists, so this decides only what an
  unopinionated window looks like.
- **How is the world doing? — AMBIENT, at the bottom.** The status bar's two ordered arrays; notifications
  land above its right end, never over content. It is a full-window flow row after the app row, so rail and
  optional dock stop at its top edge and the view/context row gets the rest of the height. The bar consumes
  its own `--line-status` height and never covers a view; a terminal's final xterm row fits above it. One-pixel
  `--line` borders own the vertical and horizontal seams, meeting as a T at the lower-left rail junction.
  The frame itself is what fills it: the workspace identity
  and the ONE BOARD LEDGER — spec nodes by state plus drift, every eval scenario state, open issues, live
  sessions — is true of the window on every route, so no view may own a duplicate and each group is
  registered here. The identity is one compact project-mark/name button that owns the catalog switcher
  and `/projects` door; the route rail contains no duplicate chip. On a graph address the same buttons acquire graph focus-walk behavior; their visual
  ownership and lifetime remain the frame's. A view contributes only
  facts about the document it is showing. That division is what stopped the bar from emptying when a view
  stopped being where a reader lands; the shape of an item and where it lands is [[status-bar]]'s.

A control belongs to the region whose question it answers, and to exactly one owner there — the dock's
  projection is named in its header, while the permanently mounted rail's mirrored panel control owns dock
  open/closed and exposes `aria-pressed`. The dock itself is content-only and has no second collapse door.

**Each region gets ONE band, and a band is a row that earns its place.** [[ui-state-model]] states the
budget and measures it; the shell's obligation is to have no spacer that stands in for a band it does not
draw. The tab strip is the top band itself, not a wrapper holding it: the strip renders unconditionally and
names the routed place when no document is held, so the row is either a working set or an answer to where
the reader is, and never 29 empty pixels. A control that belongs to the current DOCUMENT — the context
dock's toggle — rides the strip's trailing cluster beside the document actions rather than opening a
region of its own.

**The window says where it is.** The shell is the only component that reads the address, so it is the only
one that can name the place, and it writes `<place> · <project>` into the document title on every route.
The place is the same projection the tab strip draws: a document's own name, or the routed surface's name
from the shared place list, translated like every other label. Faces without an address to report — the
projects hub, the phone, every pre-board state — keep writing the plain project title; both writing it
would race, and a parent's effect lands last.

**Which session owns the graph is workspace state**, held here beside the dock preference and the split,
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
address, which it executes through [[address-routing]]; the shell does not inspect node/session data or mint
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
error boundary, so a view that throws leaves the rail, the tab strip, the status bar and the other split
pane rendering exactly as they were — a reader who can still navigate can still get out. The boundary
resets on the address it is keyed by: leaving a broken document is the natural recovery and must not cost
a reload, and the panel's retry is that same reset for when the address did not change. The console keeps
the stack; the pane shows one line. Wrapping the whole app instead would trade a broken document for a
white screen, which is the failure this exists to prevent. The other half of the same contract is the
stale dist: a lazy chunk that 404s after a redeploy retries twice, then reloads the page once (guarded, so
it can only happen once per tab) before surfacing here ([[view-registry]]).

**The sealed public face gets the frame's smallest form**: no dock, no tabs, no palette, one view. A door
that is not built is shut more firmly than a door that closes itself, which is why that face no longer
redirects away from live addresses — it never renders one.

**Two views at once is a layout, not a rewrite** — and that is the whole return on the hinge. A second view
is a second route and a place to put it; not one view changed to make it possible, because a view was
already receiving its route rather than reading it. The second pane is workspace state, true of the window
rather than of either document in it, and it survives a reload like the dock does. A reader sends a
document right by alt-clicking its tab: they are already pointing at the document they mean, so the gesture
asks for no new vocabulary and no new surface.

Measured with two live spec documents open: 0.02 seconds of script per 10 idle seconds.

**The palette is the shell's**, not a view's, because it floats above whichever view is showing; a hidden
view must never be able to swallow it. The dock toggle and the project identity are the shell's for the
same reason: they are true of the window, not of what it currently displays.
