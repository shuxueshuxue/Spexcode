---
title: view-registry
status: active
hue: 225
desc: Address kind → view, and the one contract every view obeys: it receives its route, it does not read the global one.
code:
  - spec-dashboard/src/views.jsx
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/src/tabs.js
---
# view-registry

The map from an address kind to the thing that renders it, and the single contract a view signs:

> **A view receives `{ param, query }` as props and does not read the global address.**

Everything else it needs — the board, the workspace — it asks for by context, so no component has to own
another component's props. That is what dissolved the god component: its size was not the problem, its
*ownership* was.

**`document(page, param)` marks what [[tab-strip]] may hold**, and the strip asks the registry rather than
keeping its own list. Two kinds qualify. Parameterized OBJECTS: spec, file, session, eval detail, issue
detail. And the SINGLETON boards — evals, issues, settings — whose bare address names a place the reader
keeps rather than one they bounce off; they are singletons only because their address carries no selector,
so the strip's own identity rule resolves a second opening to the same tab.

Left out: graph (including its focused node — a legacy address), bare sessions, and `empty`, which is what
shows when nothing is held at all. **`/sessions/new` was a document and is not one now**: it names no
session, so the predicate takes the selector's VALUE and not merely its presence — the launch page is a
form, and the session it starts becomes a document the moment it has an id.

**A rail destination is not the same thing as an addressable kind.** `spec` and `file` are addresses you
arrive at by opening something; there is no "go to the spec page" the way there is a sessions page. The rail
therefore has its own list, and the first version of this without that split threw `unknown icon: spec` —
the rail had faithfully tried to draw a destination that does not exist.

**Each view is lazy and pays for its own libraries.** The graph carries xyflow and mounts its own
ReactFlowProvider; hoisting that into the shell would drag the whole graph library into every face's entry
chunk, including the phone's and the sealed public build's. The retry that survives a stale dist lives here too, wrapped
around every importer, because `React.lazy` caches the rejection — a chunk that 404s once is a dead view
for the life of the page, and the importer is the only place a second attempt is still possible.
