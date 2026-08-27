---
title: tab-layout
status: active
hue: 215
desc: The tab strip's visible row, ordering, wrapping, labels, and document-action boundary.
related:
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/tabStrip.test.mjs
  - spec-dashboard/src/tabs.js
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/document-actions/spec.md
  - .spec/spexcode/spec-dashboard/dashboard-ui/app-frame/drag-gesture/spec.md
---
# tab-layout

The strip is one visible band on every route. When it has no document tabs it names the routed place quietly;
when it has tabs it names the working set. The active tab keeps the shared content seam, and the right edge is
the shell-owned document-actions slot. Documents contribute actions through the registry; they do not add a
second toolbar or identity row.

Tab order is the stored array order. Dragging splices one entry without navigating or changing its active state;
the shared drag gesture owns threshold, cancellation, and swallowed-click behavior. The strip wraps onto rows
when minimum widths cannot fit, never scrolls sideways, and remains one budget band. Labels and status marks come
from the document's existing projections; unresolved selectors show their raw address rather than blank chrome.

All tab faces share compact geometry, close affordance space, top-corner treatment, and the inactive unpinned
visual. Resource tabs remain pinned holds, and resident pages keep their registry icon. The strip context menu
provides close, close-others, and split through the workspace APIs; session-specific lifecycle verbs belong to
the session menu, not a second strip surface.
