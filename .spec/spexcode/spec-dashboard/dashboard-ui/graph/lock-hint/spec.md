---
title: lock-hint
status: active
hue: 300
desc: The locked-session banner projects the current overlay-cycle bindings into visible release guidance.
code:
  - spec-dashboard/src/lockHint.js
related:
  - spec-dashboard/src/Dashboard.jsx
---
# lock-hint

When a reader locks a session from the graph's session window, the top-centre banner makes that
scope visible: it names the locked session and turns the **currently resolved** overlay-cycle bindings
into the keycaps the reader can act on. The helper owns that narrow projection from binding to display:
it preserves the registry's actual key spelling (including uppercase reverse-cycle keys) and suppresses
the next/previous keycaps unless the locked session changes more than one node. It never invents a
modifier label or a second binding table.

The banner itself is the user-facing confirmation of a graph lock. Its surrounding renderer names an
empty or single-node scope, and its release control returns the graph to the unscoped view. Lock state,
node selection, release, and the overlay-cycle action remain `Dashboard.jsx` behaviour; the action ids
and their rebinding policy remain [[keyboard-nav]]'s `keymap.js#ACT` contract. This leaf owns neither
of those wider responsibilities, so a banner wording or projection change cannot widen keyboard-nav's
narrow code boundary.
