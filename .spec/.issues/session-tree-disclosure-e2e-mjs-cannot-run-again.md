---
concern: session-tree-disclosure.e2e.mjs cannot run against an isolated fixture — its board precondition outlives the fixture's own sessions
by: 126dc196-0608-4468-861a-68a3d2dfbbf2
status: open
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
