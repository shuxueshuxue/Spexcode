---
title: tab-layout
status: active
hue: 215
desc: The tab strip's visible row, ordering, wrapping, labels, and document-action boundary.
related:
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/test/divider-geometry.e2e.mjs
  - spec-dashboard/src/tabs.js
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/document-actions/spec.md
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/drag-gesture/spec.md
---
# tab-layout

The strip is one visible band on every route. When it has no document tabs it names the routed place quietly;
when it has tabs it names the working set. The right edge is the shell-owned document-actions slot. Documents
contribute actions through the registry; they do not add a second toolbar or identity row.

**The band meets the page at a hairline, except under the active tab.** The active tab is the page: its paper
runs straight down into the document with no line between, the way an editor's live tab is joined to its pane,
and the shared `--divider-rule` hairline runs under everything else on the band — inactive tabs, the empty
stretch, the action cluster. So the strip reads as tabs joined to their pane, not as a bar sitting above one.
The line is the band's own (an inset rule at its bottom edge, which the active tab's paper covers), and an
inactive tab carries the same rule itself so a hover wash never breaks it; the content host owns no top rule of
its own — one seam, one owner, on the shell strip and on the session document's strip alike. The terminal
surface is the one pane that keeps its own dark ground, so its tab joins the band's edge rather than its colour.

Tab order is the stored array order. Dragging splices one entry without navigating or changing its active state;
the shared drag gesture owns threshold, cancellation, and swallowed-click behavior. The strip wraps onto rows
when minimum widths cannot fit, never scrolls sideways, and remains one budget band. Labels and status marks come
from the document's existing projections; unresolved selectors show their raw address rather than blank chrome.

Wrapping begins while the row can still give each tab a readable face (a 128px per-tab budget), rather than
waiting for flex-shrink to exhaust the 120px tab floor. The active tab keeps a slightly larger 132px floor for
its persistent close affordance; once wrapped, each row shares its remaining width without dropping below those
floors.

All tab faces share compact geometry, close affordance space, and top-corner treatment; there is no second
face for a replaceable tab, because every tab is replaceable. Resident pages keep their registry icon. The
strip context menu
provides close, close-others, and split through the workspace APIs; session-specific lifecycle verbs belong to
the session menu, not a second strip surface.
