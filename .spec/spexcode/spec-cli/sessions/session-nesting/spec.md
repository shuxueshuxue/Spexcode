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
---
# session-nesting

## raw source

The session list is FLAT: a supervisor and the six workers it dispatched with `spex new` sit side by side,
indistinguishable from seven unrelated sessions. But the launch already knows the relationship — the worker
was created from inside the supervisor's own process. Capture that provenance and let the dashboard fold a
child under its spawner, so a supervised fleet reads as one collapsible group instead of a scatter, and a
glance still answers "whose turn is it?" off the PARENT alone, never a muddled aggregate of the whole subtree.

## expanded spec

**Provenance is captured once, at creation.** When `spex new` runs from inside another session,
`createSession` resolves its OWN session id through the same `ownSessionId` env read the [[comms-edge]]
reply-hint uses (in the CLI's own process) and passes it as `parent` in the `POST /api/sessions` body;
`newSession` writes it into the child's `session.json` ([[runtime]]) as a durable field, and it rides onto the
public `Session` type and `/api/graph`. A human running `spex new` from a plain shell has no session id →
`parent` stays null, so no phantom nesting — the same no-sender rule [[agent-reply-channel]] already uses.

**Nesting is DERIVED at read time, never a stored mutation on children.** Each session points only at its
DIRECT parent; the tree is rebuilt on every board read. A child nests under its parent ONLY IF that parent is
still present in the enumerated list — so closing a parent leaves its children with a dangling pointer that, on
the next read, auto-promotes them to top-level. No migration, no child rewrite. It is recursive to arbitrary
depth, the whole forest reassembled each render.

**The dashboard folds a child under its spawner.** Both session-list surfaces ([[session-console]]'s console
tabs and the map-side `SessionWindow` glance) render that forest: a parent row leads with a **fold pod** — a
small pill showing the SUBTREE COUNT (how much fleet hides here), filled while collapsed and outline once
expanded, a far more legible affordance than the old sliver of a triangle — and expanding reveals the child
rows beneath. The pod is a **pointer-only toggle**: clicking it folds/unfolds WITHOUT selecting or opening the
row, and WITHOUT stealing focus — the console's docked input box keeps focus through the click, because the pod
suppresses the pointerdown's default focus shift (it is neither a focus target itself nor a path for focus to
land on its focusable row-button ancestor). Each child row is **indented by a file-tree connector rail**: a
thin vertical spine with a branch tick at
each child (an elbow at the last), and a pass-through spine down each ancestor column with rows below — so
belonging is *drawn*, like a notes-app tree, not a blank margin. Recursive to any depth. The list is collapsed
by default, so a fleet reads as one row until
opened; ↑/↓ nav walks the VISIBLE rows, so a hidden child is never a nav ghost.

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

**Behavioural contract.** The honesty of "parent status = group status" rides existing
parked / `spex wait` / [[agent-reply-channel]] machinery, not new mechanism: after spawning children an agent
supervises them (background `spex wait <child>`) and stays `parked` while they run, only becoming `asking` when
it genuinely needs the human. Strengthened in the `supervisor` config plugin.

Out of scope: any child mutation or stored tree (read-time only); the session graph's monitor/comms edges
([[session-edges]], [[comms-edge]]) — nesting is a LIST fold, orthogonal to the live arrows.
