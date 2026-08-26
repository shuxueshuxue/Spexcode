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

The row and the forest consume one `sessionDisplayState` projection from `session.js`. The session package is
the ground truth: the dashboard renders its `status` and maps that value directly to a fixed bucket and glyph.
`asking`/`review`/`done`/`close-pending`/`error` are **needs you**; `working`/`queued` and other active values
are **running**; `offline`/`retired` are **offline**; archived records are the fourth **archive** zone and use
the muted archive mark (`○`). A dead process does not rewrite a retained review or asking status, so it remains
visible in needs-you with its lifecycle glyph and liveness only as secondary row detail. Parentage follows the
stored parent relationship; every present child remains under its present parent regardless of either session's
status or liveness. The family sits in the root's zone: **glyph ≡ the session's own status; zone ≡ the
family's root status**.

**The row.** `SessionRow` renders one session: its status colour and glyph come from `session.js`
(`STATUS_COLOR` / `STATUS_GLYPH`), its visible name from the shared `sessionHeadline` (the same door used by
@-mentions), and its stable handle only in secondary identity reveals, and its
activity from `opSummary`, which folds an op list into per-op counts using the shared `GLYPH` map.
The compact metadata group is pinned to the row's trailing edge, with operation marks before the status
glyph so the lifecycle marker has one stable rightmost position even when a `~`/`+` tally is present.
Colour is never invented here — it is read from the shared vocabulary so a status means the same thing on
every surface.

The governing human ruling is: “我们的显示模式一直都只看 parent session 是不是 running。就算你这个是 needs you 状态,
它也应该放在那个 running 的 parent session 底下,而不是自己跳到上面去、再加一个回到 parent 的链接。我们本来完全没有这套机制的…给我狠狠的删!”
It replaces cross-zone root splitting and the `○`-out-of-zone partition rule. The stored parent relationship is
the only nesting input, and the root alone chooses the family's zone.

**The console projection.** The Sessions page's tree wrapper, item, shared row face, fold pod, selection check,
and inert drag projection are one presentational tree. Multi-select is explicit row state entered from the row
context menu; it is not graph marquee selection. Dragging keeps the source row marked, follows it with the same
tree-row presentation at a reduced scale, and highlights a valid target in the same tree, while the backend
owns the reparent operation.

**The rails.** `RowLead` draws the tree connectors to the left of a row. A guide array describes the
ancestry: each entry says whether that column continues below, so the last entry becomes a tee or an
elbow and the earlier ones become rails or gaps. The lead always reserves one fixed fold/count column
before those ancestry rails whenever the row is nested or expandable. That keeps a subtree count out of
the rail columns while preserving one predictable indentation step per depth. The fold control is
positioned in that reserved column, and remains a sibling of the row button because a nested button
inside the row button would invalidate the row's own activation.

The row's overlay colour is a continuous 2px status thread on the leading edge: it spans the complete row
height at the list's left edge — the ROW carries it, not the inset body, so a nested row's indent cannot step
it right and every depth shares one line; adjacent rows touch and only a group heading breaks it. It is an
independent mark rather than an inset border or shadow, so the rounded row wash cannot turn it into a bracket
or make it touch the fold/count column.

**The fold.** `FoldPod` is the only disclosure a parent gets. It carries its own expanded state, shows
the subtree count, and is pointer-only — `tabIndex={-1}` and a suppressed mousedown focus, so
expanding a subtree never moves the keyboard surface sink. `useFold` holds that state.

**The zone.** `SessionZone` groups a `sessionForest` into one rendered block.

**The module owns no full list surface of its own.** The graph carries only a compact, collapsed
cross-reference badge; opening it uses [[session-picker]] rows and preserves the existing lock/open gestures.
The finding dock remains the desktop session list, while the graph badge is deliberately bounded and does not
render zones, nesting, drag state, or a second list model. The lock is shared workspace state: a picker row
claims a session and the graph reads the claim from [[workspace-shell]].

**The lock.** `LockGlyph` is the shared "claimed by another session" indicator: the monochrome `lock`
icon at `currentColor`, never a colour emoji, used both on the row and in the lock-hint banner so the
two cannot drift apart.

## why it is one node

The row, its rails, its fold, and its zone change together: adding a column to the lead changes what
the fold slot must reserve, and changing the forest shape changes both. Splitting them would put a
single visual decision under two owners. Feature specs that need one piece reference this node's file
in `related:` or claim a selector under it; they do not become its owner.

## the four hues

The session-list row surfaces share name and status from `session.js`, whose `sessionDisplayState` projection
and single **`STATUS_COLOR`** map paint the liveness dot, the status word, **and** the compact sidebar's status
**glyph** (`STATUS_GLYPH`) the SAME hue everywhere those rows appear (window row, console sidebar row, and the
mobile card). @-mention and search entries remain their own thin joins and do not mint a second session forest.
The document-action slot deliberately carries none of these identity/status marks. Deliberately just **four hues — a traffic
light plus grey**: green = on track, no action from you (`working`, or `parked` — paused to self-resume), yellow
= waiting on YOU (`asking`/`review`/`done`), red = `error`, grey = stopped/dormant
(`idle`/`starting`/`queued`/`close-pending`/`offline`). The colour
only answers *does this session need me?* so a glance sorts the board without a legend; the word still spells the
exact state. Green for `working` also matches the avatar's liveness ring, so dot, word, and ring never disagree.
