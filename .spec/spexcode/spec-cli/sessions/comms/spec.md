---
title: comms
status: active
hue: 280
desc: The inter-agent mesh — how one session reaches another through its resolved harness adapter, and the two relationships (watching, talking) the session graph draws between them.
---

# comms

## raw source

Once sessions are up, they **talk to and watch each other**. There is exactly **one** delivery mechanism at
product altitude — the resolved harness adapter's control channel — and everything else layers on top without inventing a second
transport: a one-way send becomes a two-way conversation by *stamping* the message, a fire-and-forget send
becomes a *recorded* relationship by logging it, and the graph that claims to show the agent network must
show **both** kinds of tie — who **watches** whom and who **talks** to whom — or it is hiding most of it.

## expanded spec

The mesh divides into the delivery path and the relationships drawn over it:

- **[[dispatch]]** — the one delivery: a prompt (message, continue, merge intent) handed to a
  session over its adapter-owned channel — fail-loud, never PTY prompt typing. Merge is itself a
  dispatched prompt, not a server-run git script.
- **[[agent-reply-channel]]** — making a send bidirectional: stamp the sender + a runnable reply hint into
  the delivered text so the recipient can reply back over the same send. A pure prompt insert, no transport
  change.
- **[[comms-edge]]** — recording each send into the recipient's per-worktree log so direct agent-to-agent
  talk becomes a first-class, restart-surviving relationship the graph draws, plus the one-shot watch-start
  handshake that tells a watched agent who now supervises it.
- **[[session-edges]]** — the live monitor network (edge A→B iff A runs `spex watch`/`spex wait` on B) and the
  `spex watch` lifecycle event stream.

So the graph reads two relationships at a glance — the directed **monitor** arrow (watching) and the
subtler undirected **comms** line with its message count (talking) — both derived from live sessions only,
both dropped when an endpoint goes offline.
