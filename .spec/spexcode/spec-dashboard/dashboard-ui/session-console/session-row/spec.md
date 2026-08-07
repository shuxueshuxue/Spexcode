---
title: session-row
status: active
hue: 205
desc: The console's session rows and the tree rails that connect them — one module owning the row, its lead glyphs, the fold control, and the zone that groups a forest.
code:
  - spec-dashboard/src/SessionWindow.jsx
related:
  - spec-dashboard/src/session.js
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/MobileApp.jsx
---
# session-row

## raw source

Every surface that lists sessions — the desktop console, the session interface, the mobile app —
draws the same row: a status glyph, a handle, a headline, an op summary, and, when the session has
children, rails and a fold control. That drawing lived in one module from the start but had no
governing node of its own; it was only ever claimed through a selector by whichever feature spec
happened to need a piece of it. When such a feature is reverted its claim leaves with it, and the
module — still imported by three surfaces — is left with no home. A file that three live surfaces
import is not an implementation detail of any one feature.

## expanded spec

`SessionWindow.jsx` owns the row and the forest around it.

**The row.** `SessionRow` renders one session: its status colour and glyph come from `session.js`
(`STATUS_COLOR` / `STATUS_GLYPH`), its identity from `sessionHandle` and `sessionHeadline`, and its
activity from `opSummary`, which folds an op list into per-op counts using the shared `GLYPH` map.
Colour is never invented here — it is read from the shared vocabulary so a status means the same
thing on every surface.

**The rails.** `RowLead` draws the tree connectors to the left of a row. A guide array describes the
ancestry: each entry says whether that column continues below, so the last entry becomes a tee or an
elbow and the earlier ones become rails or gaps. `RowLead` also reserves the fold control's slot even
when there is nothing to fold, because a nested button inside the row button would invalidate the
row's own activation.

**The fold.** `FoldPod` is the only disclosure a parent gets. It carries its own expanded state, shows
the subtree count, and is pointer-only — `tabIndex={-1}` and a suppressed mousedown focus, so
expanding a subtree never moves the keyboard surface sink. `useFold` holds that state.

**The zone.** `SessionZone` groups a `sessionForest` into one rendered block.

**The lock.** `LockGlyph` is the shared "claimed by another session" indicator: the monochrome `lock`
icon at `currentColor`, never a colour emoji, used both on the row and in the lock-hint banner so the
two cannot drift apart.

## why it is one node

The row, its rails, its fold, and its zone change together: adding a column to the lead changes what
the fold slot must reserve, and changing the forest shape changes both. Splitting them would put a
single visual decision under two owners. Feature specs that need one piece reference this node's file
in `related:` or claim a selector under it; they do not become its owner.
