---
concern: session-tree-disclosure.e2e.mjs cannot run against an isolated fixture — its board precondition outlives the fixture's own sessions
by: 126dc196-0608-4468-861a-68a3d2dfbbf2
status: landed
nodes: session-forest
created: 2026-09-12T05:53:50.627Z
---

Spec: session-forest, session-console

`spec-dashboard/test/session-tree-disclosure.e2e.mjs` gates on a board that holds, at the same
moment: a live parent/child pair, an offline root, and at least two live roots — and it waits 45s
for that.

An isolated fixture repo cannot hold that mix. A fixture session is a `sleep` standing in for an
agent, so the sessions that must stay live degrade to offline before the offline root appears;
waiting for the full predicate starves the very precondition it was meant to prepare. Measured: the
graph header is `fresh` and the offline root does appear, but `liveParentChild` is false by the time
the suite starts.

So the suite runs only against a board somebody is really working in. That makes it unrunnable as
part of a change's own proof, which is how it went stale unnoticed: it carried a whole section
asserting the retired thin session list inside the finding dock (`.dock-session-list`), a surface
that no longer exists. Its selectors are updated now (it asserts the surviving surface and that the
retired one does not come back), but the file has no green light from that change.

What it covers that nothing else does: the row-pod vs zone-header disclosure ownership across BOTH
the desktop list and the phone list, plus the Option-arrow walk and the graph's session badge, in
one flow. The desktop half is covered by `one-navigator.e2e.mjs` and `session-row-dock.e2e.mjs` in
an isolated harness; the phone half and the badge are not.

Two honest repairs, either is fine:
  - give the fixture a launcher that keeps a session live long enough to be a live root while a
    second one has already gone offline (a harness concern, not a product one), or
  - split the suite: the parts that need a rich live board stay live-only and are named as such;
    the disclosure-ownership parts move to an isolated suite that a change can actually run.

<!-- reply: 126dc196-0608-4468-861a-68a3d2dfbbf2 @ 2026-09-12T05:54:36.150Z -->
Stays open past this session deliberately: nothing in it is done. The suite's selectors are updated and it no longer asserts a surface that was deleted, but it still has no green run anywhere, and the repair is a choice between two shapes (teach the fixture to hold the liveness mix, or split the suite into a live-only half and an isolated half) that the next person working on this harness should make rather than me deciding it inside a landing. Its one durable fact for whoever picks it up: the blocker is not the graph header (measured 'fresh') and not the offline root (it does appear) — it is liveParentChild, false by the time the suite starts, because a fixture session is a sleep and dies before the mix assembles.

<!-- reply: 126dc196-0608-4468-861a-68a3d2dfbbf2 @ 2026-09-12T06:01:13.670Z -->
CORRECTION — the diagnosis in the opening post is WRONG. Superseded by what is measured below; do not act
on the first post.

What I claimed: the suite needs a live board for its whole run, and a fixture's `sleep`-backed sessions die
before the required liveness mix assembles.

What is actually true: the suite does NOT read the board while it runs. It takes ONE snapshot of
`/api/graph`, patches that snapshot, then serves the frozen copy to the page by intercepting `/api/graph`,
disables SSE, and intercepts `/api/sessions/reparent` (recording the request, never reaching the backend).
So nothing has to stay alive. The mix only has to hold at the single moment of the first fetch — and the
snapshot already manufactures the offline root itself when the board has none (`fixtureNeedsOffline`).

The real blocker is a GATE THAT DRIFTED FROM THE BODY IT GUARDS. The 45s gate demands:
  - a live parent/child pair        — the body does need this (it uses the board's real nesting)
  - an offline root                 — REDUNDANT: the body manufactures one when absent
  - at least two live ROOTS         — WRONG SHAPE: the body needs a reparent target, which need not be a root
and it never checks the one thing the body does assert on: a leaf whose STATUS is `working`/`parked`, which
no amount of tmux liveness produces because status is published by the agent, not inferred from a live pane.
So the gate is simultaneously too strict and not guarding the real precondition.

Relaxing the gate to "real nesting + three live rows", and letting the snapshot set the leaf's status the
way it already sets the offline root, makes the suite RUN on an isolated fixture. Measured on this change's
tip: it then gets as far as the fold-focus assertion (line 154). On the pre-change build the same relaxed
probe fails EARLIER, at the Alt-arrow tab move (line 145) — so this is not a regression from the navigator
change, and the relaxation alone does not make the suite green either: its later assertions depend on row
ORDER and statuses that a synthesized snapshot does not reproduce faithfully.

One thing that came out of chasing it, worth keeping: the fold-focus invariant it asserts ("clicking a
disclosure control must not steal the typing sink") HOLDS on the real product. Checked read-only on the live
gateway board: a composer textarea kept focus through a fold-pod click (`activeElement` stayed the same
element, probe stamp intact). The line-154 failure is an artifact of the synthetic board, where
`document.body.focus()` leaves no real focus owner for the suppression to protect.

So the repair is two separable pieces, and the second is the real work:
  1. Fix the gate to guard exactly what the body needs (cheap, mechanical).
  2. Decide what this suite IS. Either it is a live-board suite and says so in its name and its failure
     message — in which case it must not be read as part of any change's proof — or the assertions that do
     not need a real board (disclosure ownership, fold focus, the phone list) move into an isolated suite a
     change can actually run, and only the order/status-dependent ones stay live-only.
