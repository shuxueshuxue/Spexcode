---
title: graph
status: active
hue: 280
desc: The live session-monitor network — edge A→B iff A runs `spex watch B` — and the `spex watch` event stream.
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
(`CLAUDE_CODE_SESSION_ID`, falling back to the worktree `.session`) as the watcher plus its target
selectors — **heartbeats** while it runs, and **deregisters on exit**; a missed heartbeat drops the
registration as a backstop. Registrations are **in-memory in the server** (its single owner); the watch
process reports over HTTP at `POST /api/sessions/graph/watch` (register + heartbeat) and `…/unwatch`. A
restart starts empty and live watches re-register on their next beat. This is **best-effort on the watch
side** — a down backend delays only the edge, never the event stream.

`GET /api/sessions/graph` returns `{ nodes, edges }`: live sessions as nodes and edges **computed at
read time** from the registrations. Each watcher's **selectors are resolved live** with the same matcher
`spex ls`/`watch` use, so a **global** watcher links to **every** session (including ones launched after
the watch started) and a node/branch selector picks up future matches too. Self-edges, edges touching a
non-live session, and duplicate A→B all drop out. This stays **isolated from the board assembler** —
nothing here touches `buildBoard` or the spec tree; the dashboard's [[session-graph]] view is its (now
observational) surface.

### `spex watch` — the lifecycle event stream

`spex watch [SEL…]` is also the event source for Claude Code's Monitor tool (`watchSessions`), emitting
the **complete session lifecycle**, not only actionable transitions. A session's **first sighting** emits
a `launched` event (once per id, never re-fired, so working/idle toggles don't flap); on top of that it
emits each actionable transition (review / done / close-pending / offline / error / needs-input) and the
removal (`closed`). `closed` fires **only when a session is genuinely gone** — its worktree removed, or
it is absent for two consecutive polls — *never* on a single-poll list flicker (a worktree skipped
mid-read, a transient git/tmux hiccup), which would otherwise raise a false "session lost". The net feed
is `launched → [actionable transitions] → closed` — a true "subscribe to all session changes" stream for
a super-manager, where each watch process is one subscriber and the selector is the subscription.
