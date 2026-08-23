---
title: session-nesting
status: active
hue: 300
desc: A session launched by `spex new` from INSIDE another session records its spawner as a durable `parent`, so the dashboard folds the child under it — a read-time tree that auto-promotes orphans when a parent closes, with a purely-informational fold POD — the subtree count on the rollup colour — that never aggregates into the parent's own status or zone.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/session.js
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/sessionShortcuts.js
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/session.test.mjs
  - spec-dashboard/test/session-tree-disclosure.e2e.mjs
---
# session-nesting

## raw source

The session list is FLAT: a supervisor and the six workers it dispatched with `spex new` sit side by side,
indistinguishable from seven unrelated sessions. But the launch already knows the relationship — the worker
was created from inside the supervisor's own process. Capture that provenance and let the dashboard fold a
child under its spawner, so a supervised fleet reads as one collapsible group instead of a scatter, and a
glance still answers "whose turn is it?" off the PARENT alone, never a muddled aggregate of the whole subtree.

## expanded spec

**Provenance is captured once, then supervised through the ordinary watch command.** When `spex new` runs from inside another session,
`createSession` resolves its OWN session id through the same `ownSessionId` env read the [[agent-reply-channel]]
reply-hint uses (in the CLI's own process) and passes it as `parent` in the `POST /api/sessions` body;
`newSession` writes it into the child's `session.json` ([[runtime]]) as a durable field, and it rides onto the
public `Session` type and `/api/graph`. A human running `spex new` from a plain shell has no session id →
`parent` stays null, so no phantom nesting — the same no-sender rule [[agent-reply-channel]] already uses.
After a successful child create, the parent installs the `parent` source through the same durable watcher
mechanism [[session-reparent]] later moves. The nesting field remains provenance and layout only; the sourced
watch relation owns status delivery. It is deliberately distinct from a human's `watch` command: cancelling a
manual watch cannot dissolve parent supervision, and moving parentage cannot erase a coincident manual watch.

**Nesting is DERIVED at read time, never a stored mutation on children.** Each session points only at its
DIRECT parent; the tree is rebuilt on every board read. A child nests under its parent ONLY IF that parent is
still present in the enumerated list — so closing a parent leaves its children with a dangling pointer that, on
the next read, auto-promotes them to top-level. No migration, no child rewrite. It is recursive to arbitrary
depth, the whole forest reassembled each render. If imported or legacy records contain a parent cycle, the
cycle members are promoted to roots for that read (their descendants remain attached to them), so a malformed
family is visible rather than silently disappearing; this is a read-time projection guard, not a child rewrite.

**The CLI exposes the same provenance without pretending to be the dashboard tree.** `spex session ls` stays a
flat project board, but every row prints its direct parent id and `--children` scopes the board to the caller's
direct children. `--children=<PARENT-SEL>` chooses another parent in an attached value so a following positional
remains a child-result filter. The direct pointer remains usable after a parent closes: children are still found
by that durable id even though the dashboard's forest correctly auto-promotes them. A status summary describes
only the displayed rows; it never turns child states into the parent's lifecycle state.

**The dashboard folds a child under its spawner.** All session-list surfaces ([[session-console]]'s console
tabs, the map-side `SessionWindow` glance, and [[mobile-ui]]'s Sessions list) render that forest: a parent row
leads with a **fold pod** — a
small pill showing the SUBTREE COUNT (how much fleet hides here), filled while collapsed and outline once
expanded, a far more legible affordance than the old sliver of a triangle — and expanding reveals the child
rows beneath. The pod is a **pointer-only toggle**: clicking it folds/unfolds WITHOUT selecting or opening the
row, and WITHOUT stealing focus — the current TUI, Command Box, or New composer keeps focus through the click, because the pod
suppresses the pointerdown's default focus shift (it is neither a focus target itself nor a path for focus to
land on its focusable row-button ancestor). Each child row is **indented by a file-tree connector rail**: a
thin vertical spine with a branch tick at
each child (an elbow at the last), and a pass-through spine down each ancestor column with rows below — so
belonging is *drawn*, like a notes-app tree, not a blank margin. Recursive to any depth. The list is collapsed
by default, so a fleet reads as one row until
opened; ↑/↓ nav walks the VISIBLE rows, so a hidden child is never a nav ghost.

The desktop sessions dock is the one mutable tree surface (the former full-width document list is retired). Its fixed registry bindings are ⌥+↑/↓ for moving the selected session through visible rows, and ⌥+Shift+↓/↑ for expanding/collapsing that selected parent; the latter are consumed as no-ops on a leaf and never move selection. A primary-pointer drag starts only after a small
movement threshold, then the source row fades and its **whole console tree row** (headline, live status,
selection reveal, nesting lead, fold pod, and checkbox included) follows the pointer as a fixed ghost at **75%**
of its visual size, with its pointer anchor adjusted to the same scale. The
ghost is rendered through the same tree-row projection from the current forest item, never from a copied
appearance record or a hand-built second DOM tree; only its interaction semantics become inert. A compatible
target row gains a clear drop treatment; releasing there reparents to that row. A dragged child also reveals a
compact root drop zone above the list, whose release detaches it to top level. The source itself, its existing
parent, and any descendant are never targets, so a drag cannot create a cycle or spend a write on a no-op.
Releasing away from a target changes nothing. The map-side glance and mobile list remain read-only tree
presentations rather than acquiring a second drag model.

The desktop console layers one chord over the existing session-tab navigation: **⌥+Shift+↓ expands the
currently selected parent session and ⌥+Shift+↑ collapses it**. These chords are consumed before the ordinary
⌥+↑/↓ tab move, so they never change session selection; when the selected row has no matching state they are
simply no-ops, not tab moves. The action changes only the selected row's existing fold state, never session
data or selection. The pod remains pointer-only and non-focusable — keyboard disclosure is a console-level
route into the same fold state, not a second control or a second tree. Unmodified arrows retain their normal
terminal/input semantics.

**The parent row's own status is the group's status — no aggregation.** The folded parent's status glyph and
which triage zone it sorts into (needs-you vs self-running) are the PARENT'S OWN, full stop; child statuses
never roll up into them. This is honest only because a supervising parent stays `parked` while its children
run (below), so its status already reads "the fleet is being handled".

**The disclosure triangle COLOUR is the one thing that looks downward — and is PURELY informational.** A
recursive subtree rollup that must NOT affect the group's zone or sort, reusing the `STATUS_COLOR` hues:
GREEN when every descendant is running/self-driving (working/parked); DARK-YELLOW when at least one needs
attention (the needs-you zone — asking/review/done/close-pending, error folded in); NEUTRAL/grey when the
subtree is all idle/offline. Yellow does NOT mean "needs the human" — it may just be an actionable transition
the supervisor chain will handle, a passive hint kept out of the zone/sort, never an escalation.

**Behavioural contract.** The honesty of "parent status = group status" rides the ordinary managed
[[session-follow]] relation: source installation and reparenting first deliver one child-state snapshot, then
each later child declaration except routine `active`/working arrives in the parent's normal terminal prompt queue
and wakes it exactly like an ordinary send. A caller without that managed address backgrounds `spex session wait <child>` and stays `parked` while it runs, only becoming `asking` when it
genuinely needs the human. Strengthened in the `supervisor` config plugin.

The original spawner is the normal source of a parent edge, but supervision recovery may deliberately change
that durable edge through [[session-reparent]]. The tree remains a read-time fold: it has no stored parent
collection and no migration of a missing parent. Reparent changes the child's one pointer and the matching
`parent` watch source together; `parent: null` removes that source for an explicit top-level detach while
leaving any independent manual watch intact. Ordinary view reads still need no repair daemon.
