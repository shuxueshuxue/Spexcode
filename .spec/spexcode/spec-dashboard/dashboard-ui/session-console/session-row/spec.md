---
title: session-row
status: active
hue: 205
desc: The console's session rows and the tree rails that connect them — one module owning the row, its lead glyphs, the fold control, and the zone that groups a forest.
code:
  - spec-dashboard/src/SessionWindow.jsx
related:
  - spec-dashboard/src/session.js
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/GraphView.jsx
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

The row and the forest consume one `sessionDisplayState` projection from `session.js`. It derives a zone from
`archived` first, then offline liveness (or an explicit offline status), then the authored lifecycle. Two
projection exceptions are legislated: `queued` has not launched and remains runnable under **running**, while
`archive` is its own closed-record zone and uses the muted offline mark (`○`). Online
`asking`/`review`/`done`/`close-pending`/`error` is **needs you**, other online lifecycles are **running**, a
dead process is **offline**, and archived records are the fourth **archive** zone. A dead session keeps its
authored lifecycle in the record, but its row status/glyph is projected as offline; a `retired` record keeps
its `⚑` badge because that badge says the worktree is gone. A parent-child display edge
is retained only when both rows have the same derived zone; a child whose liveness changes zones becomes a root
in that zone, so a row's offline glyph and its zone header cannot disagree.

**The row.** `SessionRow` renders one session: its status colour and glyph come from `session.js`
(`STATUS_COLOR` / `STATUS_GLYPH`), its identity from `sessionHandle` and `sessionHeadline`, and its
activity from `opSummary`, which folds an op list into per-op counts using the shared `GLYPH` map.
Colour is never invented here — it is read from the shared vocabulary so a status means the same
thing on every surface.

**The console projection.** The desktop console's tree wrapper, item, optional select checkbox, shared row
face, and fold pod are one presentational tree. Its drag ghost renders that tree again from the same current
forest item; it does not serialize a second appearance shape. The one permitted visual difference is a 75% scale
of the ghost, so a selected row's expanded headline does not cover the receiving object; the pointer anchor is
adjusted to that scale. The other difference is semantic: the live row is a button with its handlers while the
ghost is inert. The ghost therefore keeps selected headline wrapping and its right-side marker in the same
formatting context as the source row before the final visual scale is applied.

**The rails.** `RowLead` draws the tree connectors to the left of a row. A guide array describes the
ancestry: each entry says whether that column continues below, so the last entry becomes a tee or an
elbow and the earlier ones become rails or gaps. `RowLead` also reserves the fold control's slot even
when there is nothing to fold, because a nested button inside the row button would invalidate the
row's own activation.

**The fold.** `FoldPod` is the only disclosure a parent gets. It carries its own expanded state, shows
the subtree count, and is pointer-only — `tabIndex={-1}` and a suppressed mousedown focus, so
expanding a subtree never moves the keyboard surface sink. `useFold` holds that state.

**The zone.** `SessionZone` groups a `sessionForest` into one rendered block.

**The module owns no surface of its own.** It once also exported a floating session window that hovered
over the spec-node graph; the finding dock now projects that same forest with these same rows, one pane to
the left, and two live copies of one list on one screen is not a glance but a duplicate. The window is
retired and its callers are the dock, the console and the phone. The lock it used to be the only door to is
untouched: a session is claimed from a dock row and the graph reads the claim from [[workspace-shell]].

**The lock.** `LockGlyph` is the shared "claimed by another session" indicator: the monochrome `lock`
icon at `currentColor`, never a colour emoji, used both on the row and in the lock-hint banner so the
two cannot drift apart.

## why it is one node

The row, its rails, its fold, and its zone change together: adding a column to the lead changes what
the fold slot must reserve, and changing the forest shape changes both. Splitting them would put a
single visual decision under two owners. Feature specs that need one piece reference this node's file
in `related:` or claim a selector under it; they do not become its owner.
