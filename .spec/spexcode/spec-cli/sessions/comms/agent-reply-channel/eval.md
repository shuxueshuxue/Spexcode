---
scenarios:
  - name: send-stamps-sender-and-reply-hint
    tags: [cli, backend-api]
    description: >-
      Drive the real `spex session send` CLI end-to-end over HTTP and read the message it actually PUTS ON THE
      WIRE (the delivered prompt the recipient's backend receives at POST /api/sessions/:id/input). Two shells,
      one recipient: (a) an AGENT sender — the sending shell carries a live board session id (its harness session
      env / SPEXCODE_SESSION_ID), so the sender resolves to a board row with a headline; (b) a HUMAN sender — no
      session id in the environment at all. Compare each delivered `text` to the message the caller typed.
    expected: |
      (a) Agent sender: the delivered text is the typed message UNMODIFIED at the top, then one appended line
      `— from session "<sender board headline>" (<sender FULL id>). To reply: spex session send <sender FULL id>
      "<your reply>"` — the sender named by its board HEADLINE (not the bare prompt title) delimited as a session
      title, the reply command runnable at the sender's FULL id (never a prefix, so the reply hits exactly one
      session), and the POST carries `from: <sender id>`. A sender that resolves to no board row still stamps the
      FULL id with the label omitted (`— from session <id>.`, no empty quotes/parens).
      (b) Human sender: the delivered text is the message BYTE-FOR-BYTE, no hint appended and no `from` field —
      a plain shell has no session, so no half-built reply loop is smuggled in.
    code: spec-cli/src/agent-reply-channel.test.ts
    related: [spec-cli/src/sessions.ts, spec-cli/src/cli.ts]
---
# eval.md — agent-reply-channel

The loss watched is bidirectional-messaging honesty: a `spex session send` from one agent must arrive stamped
with WHO sent it plus a runnable reply command addressed at the sender's full id, so the recipient can reply
over the same send; a human at a plain shell must get the bare message with no reply loop. Measured YATU
through the real `spex session send` verb (its own process resolves the sender via `ownSessionId` + the shared
[[remote-client]] resolver, wraps with `withSenderHint`, and POSTs the already-composed text) — the reply
channel is product semantics at the COMPOSE layer, so the delivered wire text is the exact surface to read,
never an internal helper. Evidence: the captured delivered `text` for the agent and human sender (`--result`).
