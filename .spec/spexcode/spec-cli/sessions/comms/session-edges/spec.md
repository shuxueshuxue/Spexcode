---
title: session-edges
status: active
hue: 280
desc: The live session-monitor network — edge A→B iff A subscribes to B (`spex session watch` stream or `spex session wait` one-shot) — over one shared poll + edge lifecycle.
code:
  - spec-cli/src/watch-resilience.test.ts
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
- **`spex session wait <id>`** — *take-one-TRANSITION-and-exit*, an agent's event-loop primitive, and it is
  **edge-triggered, never level-triggered**. On its first successful poll it prints and records `<id>`'s
  CURRENT status (the arrival state opens the wait's output stream), then keeps polling until it **observes a
  transition from a non-actionable status INTO an actionable one** — an *edge*, which by construction means at
  least two observed states. Only that edge returns: it prints the full observed status path on stdout
  (`review→working→close-pending` — the LAST token is the reached status), and **exits** — an agent
  backgrounds it and the harness re-invokes when the command exits, so the exit IS the wake-up. An arrival
  state that is ALREADY actionable does **not** return; the wait holds for the next edge. Each observed
  transition also narrates one stderr line as it happens, so a backgrounded wait's transcript is the state
  sequence itself. Because a FOREGROUND wait freezes the calling agent's whole turn, that warning
  lives at the point of use, not only in help prose: when the shell carries a managed-session env
  (`ownSessionId` resolves), the wait prints one prominent stderr line at start — background this; the exit
  is your wake-up — then proceeds unchanged (foreground vs background is indistinguishable from inside, so
  the hint rides every managed-agent wait; a human shell gets none).

**Why edge-triggered.** The old level-triggered wait returned the moment the target *was* actionable — which
made it useless for the one thing a manager most needs to await: a dispatched merge actually landing. During
a merge dispatch the session sits in `review` (its declared proposal state), so a wait hung "for the merge to
land" returned instantly with `review` and "wait until the merge is really on main" had no first-class verb —
managers fell back to `git merge-base --is-ancestor` polling, and one such poll misread a moved HEAD as a
landed merge, closed the session, and killed the live merge agent (recovered by fsck). Edge semantics cover
it natively: the merge agent's activity presses the status back to `working` (non-actionable), and the
landing's closing declaration jumps it back to an actionable state — a real edge, one wake-up, at the true
completion. The complementary need — "it's already actionable and I want to read it NOW" — belongs to the
one-shot snapshot verbs (`spex session ls` / `spex session review`), never to wait.

**Edge-drawing belongs to the subscription, not to `watch`** (`withWatchEdge` in `cli.ts`): BOTH commands
report the `watcher→targets` edge (register + TTL heartbeat) for as long as they run and clear it on exit.
So a supervisor backgrounding `spex session wait <worker>` is **visible on the monitor network** for the whole
wait — N waits draw N independent edges — and each clears the instant its wait resolves (supervision ended).
Edge writes are **best-effort**: the edge is cosmetic, so an unreachable backend never fails the wait (and a
killed process's edge expires by TTL), even though the poll itself does need the backend.

`wait` is **guaranteed to terminate** — the one invariant that matters for an event loop. A `--timeout`
(default 1200s) sets a deadline checked **every poll, before every sleep, even after a thrown poll**, so a
target that never produces an edge — stuck in *any* non-actionable state (`working`, `parked`, `idle`,
`queued`, `starting`), or parked on an already-actionable arrival state that never moves — can never hang the
caller: it exits non-zero at the deadline, and the timeout message carries the observed status path so the
caller sees exactly what the wait lived through. Actionable = `WATCH_ACTIONABLE` (which excludes
self-resuming `parked`, so a parked worker correctly does *not* end the wait), plus `idle` when `--idle` is
given. A vanished/closed target exits at once.

**A transient backend restart must NOT kill a wait.** The backend hot-reloads its child on every
`spec-cli/src` merge (a second of downtime behind the stable port), so a poll can fail because the backend is
momentarily **unreachable** (`ECONNREFUSED`/fetch-failed — a `BackendError` with no HTTP status). That is
transient: the wait warns once and **keeps polling** within its timeout, riding out the restart instead of
dying the instant a sibling merge lands; only exhausting the *whole* timeout still-unreachable fails (as
backend-down, not a false timeout). An **HTTP error** (reachable but broken — a `BackendError` *with* a
status) is a real terminal condition and still **fails loud at once**.

**A transport failure is never a session verdict.** `wait`'s stdout is the one surface a supervisor acts
on, so its vocabulary is split in two: a **status path** (`working→review`, statuses only) may only ever
relay **successful backend answers** — `offline` in particular only when such an answer says the session's
tmux/agent is genuinely gone — while a **backend failure** exits with its own transport-scoped token
**outside** that vocabulary: `backend-unreachable` (the whole budget spent retrying an unreachable backend)
or `backend-error` (reachable but broken, immediate), each with the failure detail on stderr. The exit codes
keep the outcomes machine-distinct: `0` edge reached (stdout = the observed path, last token the reached
status), `1` plain timeout (backend fine, no edge observed), `2` target gone, `3` backend failure. A slow or
dead backend can therefore delay a wait's answer,
but can never make it *claim* anything about the session (the false-`offline` supervisor trap, issue #40).
