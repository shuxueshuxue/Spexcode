---
concern: GET /api/sessions/graph is write-only — wait/watch diligently register edges nobody reads
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: graph
created: 2026-07-02T16:55:31.084Z
---

Found in the redundancy audit (f45d649c): spex wait/watch register/heartbeat/deregister watcher-to-worker edges via POST graph/watch, but the lone read endpoint GET /api/sessions/graph has zero consumers — the dashboard's old session-graph UI is gone (its orphan CSS was removed in this cleanup) and the queued comms-edge lane is blocked. Decide the lane: build the reader (dashboard surface for supervision edges + the queued inter-agent message edges) or retire the write path too. Half-built write infrastructure reads as coverage that does not exist.
