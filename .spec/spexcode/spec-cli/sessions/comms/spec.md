---
title: comms
status: active
hue: 280
desc: The inter-agent mesh — one durable log per session carries both what it says about itself and what others say to it; delivery is an append, supervision is a follow.
---

# comms

## raw source

Once sessions are up, they **talk to and watch each other**. Both reduce to one durable thing: each session
owns an append-only log ([[session-timeline]]) holding what it declared about itself and what others said
to it. Talking is **appending** to someone's log; watching is **reading** one. There is no second transport
and no separate relationship store — the harness adapter's control channel survives only as the courtesy
poke that turns a fresh line into a turn, and a relationship is a cursor, not a registration.

## expanded spec

The mesh is the log plus two things done with it:

- **[[dispatch]]** — delivery: append the message to the target's log under its record lock, then poke the
  adapter's control channel so a live agent sees it this turn. The append is the delivery; the poke is
  best-effort. Merge is itself a dispatched message, not a server-run git script.
- **[[agent-reply-channel]]** — making a send bidirectional: stamp the sender + a runnable reply hint into
  the delivered text so the recipient can reply back over the same send. A pure prompt insert, no transport
  change.
- **[[session-follow]]** — supervision: a durable cursor per followed session, `wait` taking the next event
  and exiting, `watch` streaming. Who supervises whom is derived from the cursors; nothing is registered
  and nothing heartbeats.

An agent therefore has exactly one place to look for everything addressed to it, and a supervisor has
exactly one place to look for everything a worker said — the same file, read from two directions.
