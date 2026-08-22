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

**Its selection used to be held by the component that also held the graph's camera and every other page's
props**, so opening a session re-rendered the graph and the graph had to know which session was selected.
Now the selection is the view's own and it derives from the view's own address — which means the class of
bug where a held selection disagrees with the address has no state left to occur in. The graph, for its
part, opens a session by navigating, and knows nothing else about it.

**A board chord can compose text before this view exists.** That handoff goes through the workspace's
one-shot compose slot rather than either view reaching into the other, because neither should have to be
mounted for the other to hand it something. The view collects it once, on arrival.
