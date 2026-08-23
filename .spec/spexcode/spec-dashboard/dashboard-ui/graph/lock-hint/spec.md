---
title: lock-hint
status: active
hue: 300
desc: The locked-session banner projects the current overlay-cycle bindings into visible release guidance.
code:
  - spec-dashboard/src/lockHint.js
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
---
# lock-hint

When a reader claims a session from the finding dock's session row ([[dock-modes]]), the top-centre banner
makes that scope visible: it names the locked session and turns the **currently resolved** overlay-cycle bindings
into the keycaps the reader can act on. The helper owns that narrow projection from binding to display:
it preserves the registry's actual key spelling (including uppercase reverse-cycle keys) and suppresses
the next/previous keycaps unless the locked session changes more than one node. It never invents a
modifier label or a second binding table.

The banner itself is the user-facing confirmation of a graph lock, and — alongside the graph's bounded session
badge ([[session-picker]]) — the thing on the graph that says a claim is in force. Its
surrounding renderer names an empty or single-node scope, and its release control (or Escape) returns the
graph to the unscoped view. The claim itself is [[workspace-shell]] state, because the surface that makes it
is the dock and the surface that shows it is the graph; node selection and the overlay-cycle action remain
graph behaviour, and the action ids and their rebinding policy remain [[keyboard-nav]]'s `keymap.js#ACT`
contract. This leaf owns none of those wider responsibilities, so a banner wording or projection change
cannot widen keyboard-nav's narrow code boundary.
