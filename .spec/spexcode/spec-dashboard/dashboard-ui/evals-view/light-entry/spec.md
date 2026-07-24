---
title: light-entry
hue: 200
desc: A route-first Eval detail entry that renders permanent evidence links before the graph, session, and terminal dashboard runtime exists.
code:
  - spec-dashboard/src/Root.jsx#Root
related:
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/route.js
  - spec-dashboard/test/evals-light-entry.e2e.mjs
---

# light-entry

An external Eval DETAIL link is an evidence-review page before it is a dashboard visit. The root route
selector resolves and normalizes the hash before importing the board runtime. A canonical
`#/evals/<node>/<scenario>` address and its legacy session-scoped detail spelling both mount the SAME
[[evals-view]] components behind a small responsive shell. There is no second detail renderer, data
projection, or URL vocabulary.

The cold detail boundary may request the one bounded [[paged-review]] detail response, its evidence, and
detail-local review resources. It does not fetch `/api/graph`, open [[graph-stream]], read a session
collection/timeline/detail, open a session terminal socket, or import graph/terminal chunks. Desktop keeps
the ordinary [[side-nav]] rail. Phone width reuses [[mobile-ui]]'s review face and bottom navigation over an
empty board projection, so responsive chrome does not become a reason to boot the board.

Navigation owns initialization. Following a real anchor from the detail to the Eval list, graph, session,
issue, or settings route swaps in [[dashboard-shell]]'s ordinary App runtime; only then do graph freshness,
session summaries, and any visited terminal transport begin. A node reference preserves its intended graph
focus through the existing tab-scoped focus key. Once
started in a tab, App stays mounted across later route changes exactly as before: graph camera and visited
terminal warmth survive a return to Evals, and the lightweight entry is not re-entered until a genuinely new
cold tab/reload starts at a detail address. This node changes no route shape and weakens no detail
loading/error/evidence behavior; it only decides which runtime is allowed to exist for that address.
