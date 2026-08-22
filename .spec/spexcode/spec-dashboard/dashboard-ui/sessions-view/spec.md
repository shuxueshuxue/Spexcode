---
title: sessions-view
status: active
hue: 232
desc: The live console as a view — same behaviour, but its selection is its own and derives from its own address.
code:
  - spec-dashboard/src/SessionsView.jsx
related:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/workspace.jsx
---
# sessions-view

The live console, mounted as a view. Every behaviour it had, it kept; what changed is where its state lives.
The bare `#/sessions` route is a finding surface and is never a top-strip document; a selected session
`#/sessions/<id>` is the object document. Its `surface` query (`conversation` or `terminal`) is passed into
the console as route state, while `surface=evals` is normalized by the route layer to the existing scoped
Evals address. Opening a session object from the dock with no active object slot appends its first tab.

**Its selection used to be held by the component that also held the graph's camera and every other page's
props**, so opening a session re-rendered the graph and the graph had to know which session was selected.
Now the selection is the view's own and it derives from the view's own address — which means the class of
bug where a held selection disagrees with the address has no state left to occur in. The graph, for its
part, opens a session by navigating, and knows nothing else about it.

**A board chord can compose text before this view exists.** That handoff goes through the workspace's
one-shot compose slot rather than either view reaching into the other, because neither should have to be
mounted for the other to hand it something.

**The slot ANNOUNCES a drop, and this view collects WHILE IT IS SHOWING.** Collecting once, on mount, was
the whole handoff while every navigation to the console built a fresh view — arrival and drop were the same
event, so a mount-time take could not miss one. [[workspace-shell]]'s mounted-document pool broke that
identity: once visited, this view stays warm, so the second composition and every one after it landed in a
slot whose only reader had already run. The symptom was silence — selecting prose in a spec and asking for a
new session opened an empty composer, with no error anywhere, because a one-shot nobody takes looks exactly
like a one-shot that was never written.

Two things restore it, and both are the same correction. Writing the slot WAKES its watchers, so a
composition made while this view is already the shown document arrives at once. And the watch is held only
while the view is SHOWING, because becoming the shown document is the arrival that still happens every
time — and it is also the only moment the composer can take the focus the seed hands it, since a textarea
inside a display-hidden pane cannot be focused. A cold mount is unchanged: a freshly mounted pane is already
the showing one, so it collects exactly as it always did.
