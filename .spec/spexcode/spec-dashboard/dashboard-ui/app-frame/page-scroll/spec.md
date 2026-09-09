---
title: page-scroll
status: active
hue: 200
desc: The ONE full-page scrollport contract shared by every document-shaped dashboard surface: inset scrollbar geometry, stable gutter, sticky containment, address-keyed restoration, and phone parity without stealing Graph, terminal, or pane-local scrolling.
code:
  - spec-dashboard/src/PageScroll.jsx#PageScroll
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/ProjectsPage.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/pageScroll.test.mjs
  - spec-dashboard/test/page-scroll.e2e.mjs
---

# page-scroll

## raw source

Document-shaped dashboard pages share one visible scrollbar geometry. The scroll track starts below the
shell edge, stops above the bottom edge, keeps a stable gutter, and returns to the exact place a reader
left when browser history brings that address back. A page supplies content; it never invents another
full-page overflow owner.

## expanded spec

`PageScroll` is the one overflow owner for the Issues list and detail, Settings, and the global Projects
page. The shell — a workspace view host on the desktop, the phone's review plane, the Projects page
itself — owns its available viewport; the primitive owns the top/bottom track inset measured from that
shell's edges, desktop end inset, stable gutter, vertical overscroll containment, and horizontal clipping.
Content owns its width and padding. Sticky children — the list's query row and its section/facet header,
the detail side rail, and the composer — pin inside this scrollport, so their geometry follows the same
viewport instead of the browser document or a page-local scroller: the query row pins at the scrollport's
top inset and the header at its own offset below that pinned row, the same offsets at 1440 and 390. A
list may place a leading child ahead of its content; it is then the scrollport's first child and pins at
the shared top inset without shifting the scrollbar track. A route with none contributes no empty sticky
geometry: the Issues list's first child is its content column.

Scroll position is remembered by the full canonical address — **the address of the PANE the page is
mounted in**, which is the window's address only when the page is the window ([[workspace-shell]]: the
phone, the hub, the cold review entry). Once documents stay mounted while hidden, reading the window's
address here let a hidden page re-key onto whatever the reader had just opened and write its own zero
position over that document's remembered one; the pane is the honest owner of "which document is this".
When returned content already has its final
height the primitive restores in the layout phase but does not yield until that target survives the next
paint: Chromium may still apply its own history scroll after React's first successful write. When a long
list arrives asynchronously, it preserves the saved target across the browser's temporary zero clamp and
keeps observing until the content can represent that position. Pointer, wheel, touch, or keyboard input
ends automatic restoration immediately so user intent wins.
List to detail is still an ordinary PUSH and browser Back still owns navigation; the primitive only
restores the nested scrollTop belonging to the returned address. Different query states keep different
positions (the bare Issues list and its `state:closed` query each come back to their own), and so do
different PROJECTS — an address is only an address inside one project, so the saved
positions are keyed under the project's scope ([[dashboard-shell]]) rather than an origin-wide one. A new
address starts at the top, and a hidden warm page keeps its own native state.

The Graph canvas and Session console do not consume this primitive: the graph camera is not document
scroll, the session list is a bounded pane, and xterm/tmux owns terminal scrollback. Popup, side-rail,
composer, and mobile timeline scrollers remain local where their contracts require them. At phone width
the same Issues pages and the direct Settings route consume the same primitive above the tab bar, with equal
top/bottom track insets, no horizontal page overflow, and the detail rail returned to ordinary document flow.
