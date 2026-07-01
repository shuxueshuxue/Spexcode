---
title: comms-edge
status: active
hue: 200
desc: Direct agent-to-agent talk (spex session send) recorded through the backend into the session's global store, surfaced as a second session-graph edge — a subtle line with a message count — beside the live monitor arrow. Plus a one-shot watch-start handshake that tells the watched agent who supervises it.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/client.ts
  - spec-cli/src/cli.ts
---
# comms-edge

## raw source

The session graph shows only LIVE monitor arrows (`A→B` = A is running `spex watch B`). But the agents
talk directly — `spex session send` is the frequent, convenient channel — and that talk is invisible,
because a send was fire-and-forget: it delivered the prompt over the rendezvous socket and recorded
NOTHING. So a graph that claims to show the agent network was hiding most of it. Make direct talk a
first-class, recorded relationship: every send is logged through the backend, and the graph draws it.

A second need: starting `spex watch B` registers the monitor edge instantly but tells B nothing — B doesn't
know it has a supervisor. The connection should be established in B's context the moment the watch starts.

## expanded spec

**A send is recorded through the backend.** `spex session send` already goes through the backend (POST
`/api/sessions/:id/keys`); it now also carries the SENDER's id. On a successful delivery the backend
appends one line — `{peer, ts}` — to the RECIPIENT's `comms.ndjson` in its **global session store**
(`sessionStoreDir(id)`, keyed by session_id — the same per-user runtime dir the session record lives in,
outside any worktree, never a worktree `.session`). Recording on the recipient side — the dir the backend
already resolved to deliver — counts each message exactly once. The log is untracked and lives and dies with
the **session record**, which is exactly right for a graph of LIVE sessions — and, unlike the in-memory
monitor registrations, it SURVIVES a backend restart. A human sending from a plain shell has no sender id, so
nothing is recorded (no self-talk, no phantom edge) — the same rule [[agent-reply-channel]] uses for its
reply hint.

**The graph draws a second edge type.** `sessionGraph()` keeps its monitor edges (`kind: monitor`, the
live `spex watch` arrows) and adds **comms edges** (`kind: comms`): it reads each live session's
`comms.ndjson` from its store dir, aggregates by unordered pair, and emits one `A↔B` edge per talking pair
carrying the message `count`. The frontend renders it distinctly from the monitor arrow — a subtler, undirected line
with the count — so "watching" and "talking" read apart at a glance. An edge to a non-live session is
dropped, like the monitor edges.

**Watch-start handshake.** When `spex watch` starts over a SPECIFIC target (not a global `@all` watcher,
and only a selector that resolves to exactly one live session), it sends that target a one-shot prompt: who
is now supervising it and how to reply (`spex session send <watcher>`). It fires at most once per target
per watch process (an in-memory guard), so a streaming watch never re-nags. The greeting rides a plain send
with NO sender id, so it is the connection notice itself and is not double-counted as agent talk on the
comms edge. The graph's monitor edge still appears instantly from the registration; the handshake adds the
in-context connection the registration alone can't — `wait` (the one-shot subscription) does not greet.

Out of scope: the monitor-edge lifecycle and drag-to-watch gesture ([[session-graph]]); the rendezvous
delivery mechanism itself ([[dispatch]]); persistence beyond the worktree (a durable cross-session audit
log would be a central store, deliberately not built here).
