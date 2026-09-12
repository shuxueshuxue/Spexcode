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
  - spec-dashboard/test/tab-context-menu.e2e.mjs
  - spec-dashboard/test/split-region.e2e.mjs
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
shell's own trailing control. The left edge is the shell-owned leading cell, occupied by the fold switch
only while the sidebar is closed. Documents contribute actions through the registry; they do not add a second
toolbar or identity row.

**The top of the frame is one row.** The band shares its height with the dock head and the context head, so
`[dock head][tabs … list]` reads as a single line across the window whatever the route, and switching
projection never moves it. When the sidebar is folded the dock head is gone and the fold switch
([[side-nav]]) takes the strip's first cell instead — `[switch][tabs … list]` — so the line keeps its left
anchor and the reader's way back to the sidebar stands exactly where the sidebar was.

**The active tab is a card; the others are text on the band.** The active tab is a card of the page's own
paper standing on the band: a hairline outlines its three free sides under 8px upper corners, and its bottom is
open, so its paper runs straight down into the document with no line between, the way an editor's live tab is
joined to its pane. Its lower corners are SHOULDERS, not corners: an 8px quarter-circle of paper outside each
side curves the card's outline outward into the band's baseline, so the card flows into the pane rather than
meeting it at a right angle. The outline is what keeps the card legible in a theme where paper and panel are a few
steps apart. Inactive tabs are not boxes: muted text on the band, a short rule (the middle half of the height)
between two inactive neighbours, a translucent wash under the pointer, and no rule beside the active card,
whose outline already separates it. The pointer lights an inactive tab's INNER band — an inset rounded rect
the height of the label, the same shape a session row wears — never the whole card. The row of cards
stands off its left neighbour by a 4px inset — the sidebar's seam, or the fold switch's cell when the sidebar
is closed — and the sidebar head rows keep the same 4px trailing inset, so the fold switch and the first
card sit close across the seam in either state. The shared
hairline runs under everything else on the band — inactive
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
replaceable tab, because every tab is replaceable. Resident pages keep their registry icon.

**The held region's band is this band naming ONE document.** A region that holds a single document needs no
list, so it draws the face a tab wears — kind icon, status mark, title — without the card, then the same
action column: that document's own registry actions ([[document-actions]], found at the address the region
holds), and one control that returns the document to the strip. There is no second tab list anywhere in the
window, because there is one working set and the strip is the row that shows it. The
strip context menu provides close, close-others, and the two split moves — right and down ([[workspace-shell]])
— through the workspace APIs, and it is the ONE menu a tab's right-click opens — for every kind of tab, session tabs included, in whichever strip draws it (the
shell's, or the Sessions document's own column). A menu that depended on what the tab held or which strip drew
it would make the same tab answer two ways. Session-specific lifecycle verbs belong to the session menu on the
session's row, not to the strip.
