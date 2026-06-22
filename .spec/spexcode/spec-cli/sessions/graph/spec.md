---
title: graph
status: active
hue: 280
desc: The live session-monitor network — edge A→B iff A runs `spex watch B` — and the `spex watch` stream / `spex wait` one-shot.
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
transition (review / done / close-pending / offline / error / needs-input) and the removal (`closed`). `closed` fires the moment a session's id is **absent from the board**, a **definitive**
removal: the board lists every worktree that exists (a flaky detail read degrades a row, never drops it; a
failed enumeration skips the poll — see [[worktree-resilience]]), so absence means the directory is actually
gone — no flicker debounce needed. Presence is tracked across **all** statuses (the
`--status` filter governs only which transitions are *emitted*, never presence), so a status leaving the
filter is never misread as a removal. The board it polls is an injected **`source`** (the backend client),
so a watch streams whatever backend `SPEXCODE_API_URL` names — even a **remote** one — and a backend-down
poll warns **once** and keeps the stream alive (never a phantom mass-`closed`). The net feed `launched →
[actionable transitions] → closed` is a true "subscribe to all session changes" stream — each watch process
one subscriber, the selector its subscription.

### `spex wait` — the one-shot blocking wait

`spex wait <id> [STATUS]` (`waitForSession`) is the **blocking counterpart** to the streaming watch: an
agent wanting to "wait for a worker" needs a call that **returns**, since `spex watch` never exits —
blocking on it hangs the caller's whole turn. `wait` reuses the same injected `source` and selector matcher,
and **exits the moment** `<id>` reaches an **actionable** status — the default set (`review`,
`needs-input`, `error`, `done`, `close-pending`, `blocked`), or the single STATUS if named — printing it.
**Bounded**: a `--timeout` (default 20 min) caps it and exits non-zero, so it can never wedge a turn;
an unknown or already-closed id is terminal and exits non-zero; a **backend-down** poll **fails loud**
rather than waiting out the timeout and reporting a false `timedOut`. Only the actionable set differs from
watch's — `wait` answers "tell me when this worker needs me", watch "stream everything".
