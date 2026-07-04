---
title: board-delivery
status: active
hue: 180
desc: How the hot /api/board surface reaches its clients cheaply — the payload stays a lean summary and freshness is pushed, not polled.
---
# board-delivery

## raw source

`/api/board` is the dashboard's single source and its hottest fetch, so its wire cost is a product concern
of its own: the snapshot once shipped over a megabyte of detail the overview never renders, re-fetched on a
blind timer. Delivery — what the payload carries and when a client re-fetches it — is one seam, distinct
from what the board *contains* (assembly stays with [[sessions]]).

## expanded spec

Three halves of one budget:

- **[[board-lean]]** — the payload: the board carries only the summary the graph overview actually
  renders; per-node detail is lazy-loaded where it is viewed, and stays fresh by construction.
- **[[board-stream]]** — the freshness: a push signal fires on real change so the client re-fetches on
  transition instead of a tight poll, with conditional requests keeping a no-change reload bodyless.
- **[[board-cache]]** — the compute: the board is BUILT once per change, not once per poll — a
  single-flight, change-invalidated cache in front of the assembly, so a poll storm shares one build
  (and mostly zero) instead of each request re-walking git, and the build never starves the liveness probe.

The three compound: the stream decides *when* the wire is paid, the lean payload decides *how much*, and
the cache decides *how often the board is built* — together they take the board from a megabyte-every-poll
that could wedge the whole server toward a small, mostly-static summary built on change and fetched from
cache. None owns the board's contents ([[sessions]]) nor the slow cold-path poll for tree reshapes
([[dashboard-shell]]); this group owns only the wire between the board and its viewers, and the cost of
producing what rides it.
