---
title: tab-layout
status: active
hue: 215
desc: The tab strip's one visible row, ordering, the clipped tail and its tab list, labels, and document-action boundary.
related:
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/test/divider-geometry.e2e.mjs
  - spec-dashboard/test/tab-overflow-list.e2e.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/tabs.js
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/document-actions/spec.md
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/drag-gesture/spec.md
---
# tab-layout

The strip is one visible band on every route, `--line-top` (36px) tall and never taller. When it has no
document tabs it names the routed place quietly; when it has tabs it names the working set. The right edge is
the shell-owned action column: the tab list first, then the active document's registry actions, then the
shell's own trailing control. Documents contribute actions through the registry; they do not add a second
toolbar or identity row.

**The top of the frame is one row.** The band shares its height with the dock head, the context head and the
rail's fold switch ([[side-nav]]), so `[switch][dock head][tabs … list]` reads as a single line across the
window whatever the route, and switching projection or folding the dock never moves it.

**The active tab is a card; the others are text on the band.** The active tab is a card of the page's own
paper standing on the band: a hairline outlines its three free sides under an 8px shoulder, and its bottom is
open, so its paper runs straight down into the document with no line between, the way an editor's live tab is
joined to its pane. The outline is what keeps the card legible in a theme where paper and panel are a few
steps apart. Inactive tabs are not boxes: muted text on the band, a short rule (the middle half of the height)
between two inactive neighbours, a translucent wash under the pointer, and no rule beside the active card,
whose outline already separates it. The shared hairline runs under everything else on the band — inactive
tabs, the empty stretch, the action column. The line is the band's own (an inset rule at its bottom edge,
which the active card's paper covers, and which shows through the transparent inactive tabs untouched); the
content host owns no top rule of its own — one seam, one owner, on the shell strip and on the session
document's strip alike. The terminal surface is the one pane that keeps its own dark ground, so its tab joins
the band's edge rather than its colour.

Tab order is the stored array order. Dragging splices one entry without navigating or changing its active state;
the shared drag gesture owns threshold, cancellation, and swallowed-click behavior. **The strip is one row.** Tabs
take their content width between a 120px floor (132px for the active card, which always shows its close
control) and a 260px ceiling, shrink toward the floor as the working set grows, and past that the row CLIPS
its tail. It never wraps — a band whose thickness was the working set moved the whole document down every
time one more thing was opened — and it never scrolls sideways behind a gesture. Labels and status marks come
from the document's existing projections. A session tab stores its last title beside its address in the shared
tab projection, so removing a closed session from the live projection does not rename an already-open tab to its
raw id. The strip does not fetch a second archive projection to draw a label; a selector with neither a live nor
stored projection shows its raw address rather than blank chrome.

**The tab list is the way back to what the row cannot show.** Whenever the strip holds a tab, the action
column's first control is a chevron that opens a menu naming every held tab in strip order — each with the face
its tab wears (a resident page's icon, a document's file mark), the active one marked as selected — and
choosing one focuses it through the ordinary `open`. The control carries a point whenever any tab is clipped,
so an off-screen tab always has a visible mark saying so. The active tab is never among the clipped: focusing a
tab (from the list, a shortcut, a link) brings it into the visible stretch, because a clipped row can still be
moved programmatically even though it offers no scrollbar. There is no "new tab" control: the working set grows
only by opening a document, and the empty workspace's doors are that gesture's home.

All tab faces share one geometry: control-size type, a kind icon or status mark, a 12px lead, and a round
20px close target that shows on the active card and under the pointer; there is no second face for a
replaceable tab, because every tab is replaceable. Resident pages keep their registry icon. The
strip context menu
provides close, close-others, and split through the workspace APIs; session-specific lifecycle verbs belong to
the session menu, not a second strip surface.
