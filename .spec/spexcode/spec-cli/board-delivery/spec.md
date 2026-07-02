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

Two halves of one budget:

- **[[board-lean]]** — the payload: the board carries only the summary the graph overview actually
  renders; per-node detail is lazy-loaded where it is viewed, and stays fresh by construction.
- **[[board-stream]]** — the freshness: a push signal fires on real change so the client re-fetches on
  transition instead of a tight poll, with conditional requests keeping a no-change reload bodyless.

The two compound: the stream decides *when* the wire is paid, the lean payload decides *how much* —
together they take the board from megabyte-every-poll toward a small, mostly-static summary fetched only
on change. Neither owns the board's contents ([[sessions]]) nor the slow cold-path poll for tree reshapes
([[dashboard-shell]]); this group owns only the wire between the board and its viewers.
