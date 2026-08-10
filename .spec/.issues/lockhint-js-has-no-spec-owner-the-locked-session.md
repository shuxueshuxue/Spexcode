---
concern: lockHint.js has no spec owner: the locked-session banner projects overlay-cycle bindings but keyboard-nav intentionally governs only keymap.js#ACT, and its current YATU scenarios do not cover the banner. Add a dedicated lock-hint leaf with a real UI scenario; do not satisfy this with lockHint.test.mjs alone.
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: landed
nodes: keyboard-nav
created: 2026-08-10T05:28:05.244Z
---

The helper is behaviorally part of the keyboard-nav contract: the locked-session banner must name the grip and point at overlay-cycle keys, including the no-cycle case. It cannot be added as another code file on keyboard-nav without violating that nodes narrow registry boundary. The smallest honest repair is a dedicated lock-hint node owning spec-dashboard/src/lockHint.js plus a browser scenario that proves key labels and count-dependent presentation through the visible banner. Spec: keyboard-nav

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T09:51:29.953Z -->
Resolved on main. A dedicated graph/lock-hint leaf now owns spec-dashboard/src/lockHint.js, while keyboard-nav remains scoped to its keymap contract. The accompanying real Chromium scenario exercises the actual locked-session banner through the graph UI, verifies visible key labels and the no-cycle presentation, then verifies clearing on release. This is an ownership and same-surface evidence repair; no dashboard behavior or eval semantics changed.
