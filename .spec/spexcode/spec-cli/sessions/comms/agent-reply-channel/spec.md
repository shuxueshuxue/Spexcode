---
title: agent-reply-channel
status: active
hue: 280
desc: A send stamps WHO sent it + a reply hint into the delivered message, so the recipient can reply over the same send.
code:
  - spec-cli/src/agent-reply-channel.test.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
---

# agent-reply-channel

## raw source

`spex session send` is one-way: a message arrives in the recipient's prompt with no trace of who sent it,
so an agent can read a request but can't answer it. Make it **bidirectional** — let a supervised agent
**reply to whoever sent it**. Not a new mechanism: reuse the existing send. Just **stamp the sender** and
**insert a reply hint** into the delivered message, so the recipient **can** reply (or ignore), and the
reply **rides the same send** straight back into the sender's prompt. No workflow enforcement, no ack
protocol — only a **prompt insert**. A human running `send` from a plain shell has no session, so they get
the bare message with no hint — the loop closes only between two agents.

## expanded spec

**The wrap is `withSenderHint`, a pure prompt insert** ([[dispatch]]'s `sessions.ts`). Given the message
text and a sender `{ id, label }`, it appends one line:
`— from session "<label>" (<id>). To reply: spex session send <id> "<your reply>"`. The reply command is a
**runnable** `spex session send` at the sender's **FULL id** — the recipient pastes intent into it and the
reply travels the identical path back.

**The sender label is the board HEADLINE, not the bare prompt title.** The name comes from `sessionHeadline`
(the unified cross-surface title — the SAME chain the board card shows: a chosen name ▸ the live Claude-Code
self-summary `activity` ▸ a fuller prompt preview ▸ node/title/branch/id), NOT the stable `sessionLabel`
which stops at the 7-word prompt-truncation `title`. So the recipient recognises the sender the way it reads
the board — a concise "what they're doing", not a slice of their raw launch prompt. And the label is
**delimited** as `session "<headline>"` so it reads AS a session title, not as prose bleeding into the
message. A sender with no richer name than its id is stamped `session <id>` (no empty quotes/parens); with
**no sender at all** the message passes through **unchanged** — no hint, no half-built reply loop. The watch
handshake greeting ([[comms-edge]]) names the watcher by the same `sessionHeadline`, delimited the same way.

**The sender is resolved in the send command's OWN process, because only it knows who's sending.** The
injection itself happens in the backend (the rendezvous socket — [[dispatch]]), a *different* process that
has no idea which agent invoked the CLI. So the sender identity must be captured and the message wrapped
**before** it leaves the CLI: the `session send` verb reads its own `ownSessionId` (Claude Code's
`CLAUDE_CODE_SESSION_ID`, else the cwd `.session`), resolves that id against the live board through the
shared [[remote-client]] `resolveClientSession` to get the display label ([[session-selectors]] is reused
for the **recipient** too), wraps with `withSenderHint`, and only then calls `clientSend`. The transport
stays dumb — `clientSend` / `POST …/keys` carry the already-wrapped text and learn nothing about senders,
so the reply-channel is product semantics living at the compose layer, not smuggled into the socket.

**Graceful when there's no sender.** A human at a plain shell (no `CLAUDE_CODE_SESSION_ID`, no `.session`
in cwd) yields `ownSessionId() === null` → `sender = null` → the bare message is delivered, exactly as
before this node existed. A sender id that resolves to no board row still stamps that **full id** (label
omitted), so the reply target is never lost even if the row is momentarily unlistable.
