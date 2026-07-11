---
title: session-edges
status: active
hue: 280
desc: The live session-monitor network — edge A→B iff A subscribes to B (`spex session watch` stream or `spex session wait` one-shot) — over one shared poll + edge lifecycle.
related:
  - spec-cli/src/sessions.ts
---

# session-edges

## raw source

Sessions form a **directed monitor network** — one of the two ties the edges payload carries (the *talking*
tie is [[comms-edge]]'s). A **monitor** edge means exactly one thing: **A→B iff agent A is right now running
`spex session watch`/`spex session wait` on B**. The monitor network is **derived from live watches, never
persisted** — no subscription store, no datastore, no file; a monitor edge exists **only while that watch
runs**.

## expanded spec

When a `spex session watch` starts it **registers with the backend** — reporting its own session id
(`ownSessionId` — the harness env var, e.g. `CLAUDE_CODE_SESSION_ID`; no worktree fallback) as the watcher plus its target selectors —
**heartbeats** while it runs, and **deregisters on exit**; a missed heartbeat drops the registration as a
backstop. Registrations are **in-memory in the server** (its single owner); the watch reports over HTTP
(`POST …/edges/watch` register+heartbeat, `…/edges/unwatch`). A restart starts empty and live watches
re-register on their next beat. **Best-effort on the watch side** — a down backend delays only the edge,
never the event stream.

`GET /api/sessions/edges` returns `{ nodes, edges }`: live sessions as nodes. This node owns the **monitor**
edges, **computed at read time** from the registrations (the persisted **comms** edges on the same payload
are [[comms-edge]]'s). Each watcher's **selectors are resolved live** with the same matcher `spex session
ls`/`session watch` use, so a **global** watcher links to **every** session (incl. ones launched after the watch
started) and a node/branch selector picks up future matches too. Self-edges, edges touching a non-live
session, and duplicate A→B all drop out. This stays **isolated from the graph assembler** — nothing here
touches `buildBoard` or the spec tree; `GET /api/sessions/edges` is its read surface.

### `spex session watch` — the lifecycle event stream

`spex session watch [SEL…]` is also the event source for Claude Code's Monitor tool (`watchSessions`), emitting
the **complete session lifecycle**, not only actionable transitions. A session's **first sighting** emits a
`launched` event (once per id, never re-fired, so working/idle toggles don't flap); then each actionable
transition (review / done / close-pending / offline / error / asking) and the removal (`closed`). `closed` fires the moment a session's id is **absent from the graph payload**, a **definitive**
removal: the payload lists every worktree that exists (a flaky detail read degrades a row, never drops it; a
failed enumeration skips the poll — see [[worktree-resilience]]), so absence means the directory is actually
gone — no flicker debounce needed. Presence is tracked across **all** statuses (the
`--status` filter governs only which transitions are *emitted*, never presence), so a status leaving the
filter is never misread as a removal. The payload it polls is an injected **`source`** (the backend client),
so a watch streams whatever backend `SPEXCODE_API_URL` names — even a **remote** one — and a backend-down
poll warns **once** and keeps the stream alive (never a phantom mass-`closed`). The net feed `launched →
[actionable transitions] → closed` is a true "subscribe to all session changes" stream — each watch process
one subscriber, the selector its subscription.

### Two consumption policies, one subscription: `watch` (stream) and `wait` (one-shot)

`watch` and `wait` are the SAME subscription — poll the graph `source`, draw the `watcher→targets` edge —
under two **consumption policies**; only how they consume transitions differs:

- **`spex session watch [SEL…]`** — *stream forever*, for a human monitoring the sessions. Emits every actionable
  transition; never exits (so a turn must never block on it).
- **`spex session wait <id>`** — *take-one-and-exit*, an agent's event-loop primitive. Polls until `<id>` is
  actionable, prints that status, and **exits** — an agent backgrounds it and the harness re-invokes when
  the command exits, so the exit IS the wake-up. (Emit is silent: a backgrounded wait wants one clean status
  line, not the stream.) Because a FOREGROUND wait freezes the calling agent's whole turn, that warning
  lives at the point of use, not only in help prose: when the shell carries a managed-session env
  (`ownSessionId` resolves), the wait prints one prominent stderr line at start — background this; the exit
  is your wake-up — then proceeds unchanged (foreground vs background is indistinguishable from inside, so
  the hint rides every managed-agent wait; a human shell gets none).

**Edge-drawing belongs to the subscription, not to `watch`** (`withWatchEdge` in `cli.ts`): BOTH commands
report the `watcher→targets` edge (register + TTL heartbeat) for as long as they run and clear it on exit.
So a supervisor backgrounding `spex session wait <worker>` is **visible on the monitor network** for the whole
wait — N waits draw N independent edges — and each clears the instant its wait resolves (supervision ended).
Edge writes are **best-effort**: the edge is cosmetic, so an unreachable backend never fails the wait (and a
killed process's edge expires by TTL), even though the poll itself does need the backend.

`wait` is **guaranteed to terminate** — the one invariant that matters for an event loop. A `--timeout`
(default 1200s) sets a deadline checked **every poll, before every sleep, even after a thrown poll**, so a
worker stuck in *any* non-actionable state (`working`, `parked`, `idle`, `queued`, `starting`) can never
hang the caller — it exits non-zero at the deadline. Actionable = `WATCH_ACTIONABLE` (which excludes
self-resuming `parked`, so a parked worker correctly does *not* end the wait), plus `idle` when `--idle` is
given. A vanished/closed target exits at once.

**A transient backend restart must NOT kill a wait.** The backend hot-reloads its child on every
`spec-cli/src` merge (a second of downtime behind the stable port), so a poll can fail because the backend is
momentarily **unreachable** (`ECONNREFUSED`/fetch-failed — a `BackendError` with no HTTP status). That is
transient: the wait warns once and **keeps polling** within its timeout, riding out the restart instead of
dying the instant a sibling merge lands; only exhausting the *whole* timeout still-unreachable fails (as
backend-down, not a false timeout). An **HTTP error** (reachable but broken — a `BackendError` *with* a
status) is a real terminal condition and still **fails loud at once**.

**A transport failure is never a session verdict.** `wait`'s stdout line is the one thing a supervisor acts
on, so its vocabulary is split in two: a **session status** (`review`, `done`, `offline`, …) may only ever
relay a **successful backend answer** — `offline` in particular only when that answer says the session's
tmux/agent is genuinely gone — while a **backend failure** exits with its own transport-scoped token
**outside** that vocabulary: `backend-unreachable` (the whole budget spent retrying an unreachable backend)
or `backend-error` (reachable but broken, immediate), each with the failure detail on stderr. The exit codes
keep the outcomes machine-distinct: `0` actionable status, `1` plain timeout (backend fine, session never
actionable), `2` target gone, `3` backend failure. A slow or dead backend can therefore delay a wait's answer,
but can never make it *claim* anything about the session (the false-`offline` supervisor trap, issue #40).
