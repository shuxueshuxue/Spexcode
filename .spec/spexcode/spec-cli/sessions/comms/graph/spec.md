---
title: graph
status: active
hue: 280
desc: The live session-monitor network — edge A→B iff A subscribes to B (`spex watch` stream or `spex wait` one-shot) — over one shared poll + edge lifecycle.
code:
  - spec-cli/src/sessions.ts
---

# graph

## raw source

Sessions form a **directed monitor network**, and an edge means exactly one thing: **A→B iff agent A is
right now running `spex watch B`** over B. The graph is **derived from live watches, never persisted** —
no subscription store, no datastore, no file; an edge exists **only while that watch runs**.

## expanded spec

When a `spex watch` starts it **registers with the backend** — reporting its own session id
(`CLAUDE_CODE_SESSION_ID`, else the worktree `.session`) as the watcher plus its target selectors —
**heartbeats** while it runs, and **deregisters on exit**; a missed heartbeat drops the registration as a
backstop. Registrations are **in-memory in the server** (its single owner); the watch reports over HTTP
(`POST …/graph/watch` register+heartbeat, `…/unwatch`). A restart starts empty and live watches re-register
on their next beat. **Best-effort on the watch side** — a down backend delays only the edge, never the
event stream.

`GET /api/sessions/graph` returns `{ nodes, edges }`: live sessions as nodes and edges **computed at read
time** from the registrations. Each watcher's **selectors are resolved live** with the same matcher `spex
ls`/`watch` use, so a **global** watcher links to **every** session (incl. ones launched after the watch
started) and a node/branch selector picks up future matches too. Self-edges, edges touching a non-live
session, and duplicate A→B all drop out. This stays **isolated from the board assembler** — nothing here
touches `buildBoard` or the spec tree; the dashboard's [[session-graph]] is its observational surface.

### `spex watch` — the lifecycle event stream

`spex watch [SEL…]` is also the event source for Claude Code's Monitor tool (`watchSessions`), emitting
the **complete session lifecycle**, not only actionable transitions. A session's **first sighting** emits a
`launched` event (once per id, never re-fired, so working/idle toggles don't flap); then each actionable
transition (review / done / close-pending / offline / error / asking) and the removal (`closed`). `closed` fires the moment a session's id is **absent from the board**, a **definitive**
removal: the board lists every worktree that exists (a flaky detail read degrades a row, never drops it; a
failed enumeration skips the poll — see [[worktree-resilience]]), so absence means the directory is actually
gone — no flicker debounce needed. Presence is tracked across **all** statuses (the
`--status` filter governs only which transitions are *emitted*, never presence), so a status leaving the
filter is never misread as a removal. The board it polls is an injected **`source`** (the backend client),
so a watch streams whatever backend `SPEXCODE_API_URL` names — even a **remote** one — and a backend-down
poll warns **once** and keeps the stream alive (never a phantom mass-`closed`). The net feed `launched →
[actionable transitions] → closed` is a true "subscribe to all session changes" stream — each watch process
one subscriber, the selector its subscription.

### Two consumption policies, one subscription: `watch` (stream) and `wait` (one-shot)

`watch` and `wait` are the SAME subscription — poll the board `source`, draw the `watcher→targets` edge —
under two **consumption policies**; only how they consume transitions differs:

- **`spex watch [SEL…]`** — *stream forever*, for a human monitoring the board. Emits every actionable
  transition; never exits (so a turn must never block on it).
- **`spex wait <id>`** — *take-one-and-exit*, an agent's event-loop primitive. Polls until `<id>` is
  actionable, prints that status, and **exits** — an agent backgrounds it and the harness re-invokes when
  the command exits, so the exit IS the wake-up. (Emit is silent: a backgrounded wait wants one clean status
  line, not the stream.)

**Edge-drawing belongs to the subscription, not to `watch`** (`withWatchEdge` in `cli.ts`): BOTH commands
report the `watcher→targets` edge (register + TTL heartbeat) for as long as they run and clear it on exit.
So a supervisor backgrounding `spex wait <worker>` is **visible on the graph** for the whole wait — N waits
draw N independent edges — and each clears the instant its wait resolves (supervision ended). Edge writes
are **best-effort**: the edge is cosmetic, so an unreachable backend never fails the wait (and a killed
process's edge expires by TTL), even though the poll itself does need the backend.

`wait` is **guaranteed to terminate** — the one invariant that matters for an event loop. A `--timeout`
(default 1200s) sets a deadline checked **every poll, before every sleep, even after a thrown poll**, so a
worker stuck in *any* non-actionable state (`working`, `parked`, `idle`, `queued`, `starting`) can never
hang the caller — it exits non-zero at the deadline. Actionable = `WATCH_ACTIONABLE` (which excludes
self-resuming `parked`, so a parked worker correctly does *not* end the wait), plus `idle` when `--idle` is
given. A vanished/closed target exits at once; a backend-down poll **fails loud**, never a false timeout.
