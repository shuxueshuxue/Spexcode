---
title: tab-lifecycle
status: active
hue: 215
desc: Workspace tab removal, focus history, and deterministic close destinations.
related:
  - spec-dashboard/src/tabs.js
  - spec-dashboard/src/tabModel.test.mjs
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/test/tab-close-focus-history.e2e.mjs
  - .spec/spexcode/spec-dashboard/dashboard-ui/session-console/resource-tabs/spec.md
---
# tab-lifecycle

Closing removes exactly the selected tab. If it was not active, the current document stays active. If it was
active, the strip chooses one destination through `closeDestination`: the most recently focused surviving tab
first, then the nearest surviving tab of the same kind (right wins a tie), then the nearest tab of any kind.
Focus history is in-memory and prunes keys for tabs that left the working set.

Closing a published resource returns to its owning session tab when that session remains open. Closing the last
session or any other last document follows the explicit no-tab destinations: resource to New Session, spec/file
to Graph, and other documents to Empty Workspace. A session close therefore never throws the reader into Graph;
the retained session record remains readable as its archive projection converges.

The rule is kind-independent and has no per-document close branches beyond the resource owner contract. Tab
context-menu close, close-others, middle-click close, and the visible close button all use the same store APIs.
