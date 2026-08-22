---
title: workspace-shell
status: active
hue: 220
desc: The frame — rail, dock, tab strip, content area, status bar — and deliberately nothing else.
code:
  - spec-dashboard/src/Shell.jsx
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

**The window answers four different questions, and each gets its own region.** This is the hierarchy the
whole shell hangs off, re-derived from what the product is rather than from what the code used to be:

- **Where is everything? — FINDING, on the left.** The rail is an **activity bar**: the explorer and
  sessions projection buttons, search, then the singleton boards (evals, issues, settings pinned at the
  bottom). The dock beside it is one finding surface with two projections. Looking must be free: browsing a
  finding surface never grows any state but the camera's.
  **The dock is a property of the focused tab** — both its projection and its existence. A session document
  brings the session list, a node or a governed file brings the explorer, and a singleton board brings no
  sidebar at all, taking the full width instead of inheriting the tree the last tab was showing. So the
  sidebar describes the working set rather than being a setting maintained beside it, and the rail's lit
  button reads as *where this document belongs* ([[dock-modes]]). A rail click overrides the derivation by
  hand and the override lapses at the next focus change ([[file-tree]]).
- **What am I reading? — HOLDING, in the center.** The tab strip is the working set and the route is the
  active tab; everything readable is a document with an address — a node, a file, a session, an eval, an
  issue, and the **singleton boards** (evals, issues, settings), which are tabs you keep rather than places
  you bounce off. **The strip is the workspace itself**: *"应该被保留的是各个 tab，各个 tab 才相当于是工作
  区，而不是左侧边栏。"* The rail is only a way to change destination and the dock only describes the
  current tab; what the reader is working on stays on screen and one click away, on every route. Entering a document from a finding surface follows in place; holding it is the deliberate gesture
  ([[tab-strip]]). An empty workspace is an explicit state, not a gap the frame fills with a document: the
  center says it holds nothing and names the ways back in, because no view may arrive as a substitute for
  the reader's own answer.
- **What surrounds this thing? — CONTEXT, on the right.** The second pane today (a document sent right);
  the mockup's backlinks/scenarios panel when it earns its keep. Context is about the current document,
  which is why it is not a finding surface and not a tab.
- **How is the world doing? — AMBIENT, at the bottom.** The status bar's two ordered arrays; notifications
  land above its right end, never over content.

A control belongs to the region whose question it answers, and to exactly one owner there — the dock's
explorer/sessions mode buttons sit on the rail with the other finding controls, not in a second dock modebar
or on the status bar. The dock itself is content-only.

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

**The shell is the only component that reads the global address.** A view receives `{param, query}` as
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

Measured with six documents mounted (`test/keep-alive.e2e.mjs`): every warm switch under 0.2s, a document's
own DOM node surviving a round trip through two other tabs, and **0.012 seconds of script per 10 idle
seconds** — 0.021s with a live session console hidden among them, whose cost is terminal output arriving
rather than the pool.

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
