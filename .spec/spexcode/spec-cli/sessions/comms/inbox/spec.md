---
title: inbox
status: active
hue: 280
desc: Receipt as an act the recipient performs on its own canonical queue — a one-shot dequeue, a blocking wait-dequeue for a background command, and a persistent stream-dequeue for a monitor — plus the SessionStart registration that gives a self-launched harness its address.
code:
  - spec-cli/src/session-inbox.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/session-inbox.cli.test.ts
  - .spec/spexcode/spec-cli/sessions/comms/dispatch/spec.md
  - .spec/spexcode/spec-cli/sessions/comms/delivery-queue/spec.md
  - .spec/spexcode/session-runtime/self-launch-entry/spec.md
---
# inbox

## raw source

A governed agent never looks for its mail: the backend that owns its adapter hands each queued message over as a
prompt ([[delivery-queue]]). Two callers have no such backend — a harness a person started themselves, and a governed
session whose backend is down — and both must be able to **take** what is addressed to them, without a daemon, without
a hook that reads mail on their behalf, and without a second CLI. Receiving is therefore an act the recipient performs.
A harness offers exactly three ways to run such an act, and they are not interchangeable: a command that returns now,
a command that blocks and whose exit is the notification, and a process that keeps emitting lines. One verb per shape.

## expanded spec

All three verbs read **the caller's own address** — this shell's session identity, or an explicit `--session
<FULL-ID>` — from the same canonical queue the backend's adapter drain reads, and every message they print was
consumed through the protocol's at-most-once dequeue in that same instant. A message printed here is gone from the
queue exactly as a handover would have removed it; the verbs never peek-and-keep, because a peek that leaves the row
pending invites the adapter to deliver it again. The address must already be registered: a governed session's address
exists from create, a self-launched one's from its `SessionStart` hook; an unregistered id is refused with the two
ways an address comes to exist, never created as a side effect of reading.

- **`dequeue`** — one-shot. Take at most one message now, print it, exit 0. An empty queue is a normal result: no
  output (`null` with `--json`), exit 0. This is what a caller runs in the foreground when it wants to know, now.
- **`wait-dequeue`** — a background command. Block until one message can be taken or the deadline passes
  (`--timeout`, default 1200 s); print the message and exit 0, or exit 1 having consumed nothing. It announces on
  stderr that it blocks and should run in the background, because its **exit is the wake-up**: a harness that
  notifies on background-command completion notifies the caller once per message it asked for. It is distinct from
  `wait`, which watches other sessions' state transitions and only observes the caller's own log.
- **`stream-dequeue`** — a persistent monitor. Print one line per message as each arrives and never exit on its own;
  `SIGINT`/`SIGTERM` end it cleanly. This is the shape a line-oriented monitor wants (`tail -f`, not `until`); running
  it as a background command would never complete. `--json` emits one object per line.

Arrival is detected by polling the queue at `--interval` (default 1 s, floor 50 ms). This is the honest primitive:
the protocol's wake hints only lower latency and correctness never depends on them, so a lost hint delays a message
and never loses one. A lost race with another consumer (the head changed between read and take) retries on the new
head rather than reporting a message it did not consume.

Rendering is the same for all three. A UTF-8 body is printed verbatim (the block form: one header line naming sender,
kind, message id and enqueue time, then the text; the line form for a stream collapses newlines to a visible mark). A
body that is not UTF-8 is never rendered as empty text: it is printed as base64 with its message id, so opaque bytes
can be recovered. `--json` carries `{messageId, kind, from, enqueuedAt, text | bodyBase64}`.

**Registration** is the fourth operation this module owns, invoked by the [[session-listen]] hook as
`spex internal session-register <native-session-id>`: it initializes that id as a protocol address in the project's
canonical store — only when that store already exists and reads `ready`. Any other cutover state answers
`skipped: <state>` and exits 0: a project with no governed backend has nothing to register into, and registration must
never create a store to have somewhere to write. Initialization is idempotent and creates no governed lifecycle record.

What this module does not do: it never pushes, never binds a runtime, never reads or writes a governed record, never
opens a second database, and never decides for a governed session whether its backend or its own verb should take a
message — both read the same at-most-once queue, and whichever runs first wins, which is the contract the queue already
had.
