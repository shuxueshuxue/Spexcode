---
title: comms
status: active
hue: 280
desc: The inter-agent mesh — one durable log per session carries both what it says about itself and what others say to it; delivery is an append, supervision is a follow.
---

# comms

## raw source

Once sessions are up, they **talk to and watch each other**. Both rest on one durable thing: each session
owns an append-only log ([[session-timeline]]) holding what it declared about itself and what others said
to it. Talking is **appending** to someone's log; watching is **reading** one. There is no separate
relationship store — a relationship is a cursor, not a registration. What the log deliberately does not do is
hand a message over: that is a debt the target owes its agent, kept in its own queue ([[delivery-queue]]) and
paid through the harness adapter, so a message from another agent arrives in exactly the shape a human's does.

## expanded spec

The mesh is the log plus three things done with it:

- **[[dispatch]]** — acceptance: append the message to the target's log and enqueue it, both under that
  session's record lock. The write decides success; the transport never does. Merge is itself a dispatched
  message, not a server-run git script.
- **[[delivery-queue]]** — handover: drain what is owed into the target's adapter as an ordinary prompt,
  retried until it lands, in order, exactly once.
- **[[agent-reply-channel]]** — making a send bidirectional: stamp the sender + a runnable reply hint into
  the delivered text so the recipient can reply back over the same send. A pure prompt insert, no transport
  change.
- **[[session-follow]]** — supervision: a durable cursor per followed session, `wait` taking the next event
  and exiting, `watch` streaming. Who supervises whom is derived from the cursors; nothing is registered
  and nothing heartbeats.

An agent therefore never looks for its mail at all — it arrives as a prompt — while a supervisor has exactly
one place to look for everything a worker said and everything said to it. The log is read; it is not a chore.
