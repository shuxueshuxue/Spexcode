---
title: delivery-queue
status: active
hue: 280
desc: What a session is still OWED — a small ordered queue of messages not yet handed to its agent, drained by adapter insert, empty when nothing is owed.
code:
  - spec-cli/src/delivery-queue.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/index.ts
  - spec-cli/src/delivery-queue.test.ts
---

# delivery-queue

## raw source

A message has two entirely different lives, and giving one file both is what made this mechanism drift. Its
first life is **history**: it was said, it is part of the conversation, it is evidence, and it must survive as
long as the session does — that is [[session-timeline]]. Its second life is a **debt**: it has not yet been put
in front of the agent, and it stops existing the moment it has. A debt is not history. It is small, it is
ordered, it is consumed, and its natural resting state is EMPTY.

Reading the history to compute the debt is what a cursor into the log was: `pos` said "everything before here
is settled", so answering "what do I still owe?" meant parsing a file that only grows, and a session's own
declarations had to be *consumed* as if they were mail because they shared the counter. The queue below asks
for none of that. Nothing is owed exactly when the queue is empty, which is a fact about a small file rather
than a computation over a large one.

That is also why an old session cannot be ambushed by its own past: a queue is only ever filled by an enqueue,
so a session that predates this mechanism starts owing nothing, and the thousands of lines its log already
holds stay what they always were — history.

## expanded spec

`pending.json`, in the session's global store dir, is an ordered list of the messages that have been recorded
but not yet handed to the agent. Each entry is self-contained — the message id, the sender, and the text
exactly as it will be handed over, mechanism inserts already composed in ([[session-timeline]] owns that seam;
the log keeps the raw conversational text, the queue keeps the transport form) — so the delivery path never
reads the log. Transport state and record are therefore independent: history could be trimmed, archived, or
read by anyone without changing what is owed. An empty queue is deleted rather than stored as an empty list,
so "is anything owed?" is the existence of a file.

**The enqueue rides the append.** `sendText` records the `sent` line and enqueues the same message inside one
hold of the session's record lock ([[dispatch]]). Success is still decided by the record write, unchanged: the
queue is what the message is owed, not whether it was accepted. The record is written first — a crash between
the two writes must leave a message that is visible but undelivered, never one delivered but unrecorded.

**Draining is claim-insert-remove, under the queue's own lock.** A delivery pass takes the queue lock, and for
each entry in order composes the prompt through the one seam ([[session-timeline]]) and hands it to the
resolved adapter. A confirmed insert removes that entry; an insert the adapter refuses, cannot reach, or that
throws ENDS the pass with the entry still queued, and everything behind it stays behind it — order is a
property of a conversation, so a message is never skipped to deliver a later one.

The lock spans the insert deliberately, and it is NOT the record lock: the record lock cannot span an adapter
call (a native turn runs lifecycle hooks that re-enter the record writer, which is a deadlock), while nothing
in the delivery path takes this one. Holding it across the insert is what makes "claim" real, so two processes
draining the same session at the same moment cannot both hand over the same message.

**Any process may drain; one process is expected to.** A pass costs nothing when the queue is empty, so
`sendText` runs one immediately in whatever process called it — that is what keeps a `spex session send` from a
plain shell working with no backend alive. The retry belongs to the `spex serve` that owns the project root:
it watches its sessions' queues and drains what an earlier pass could not, so a message owed to an agent whose
harness was busy, restarting, or gone is delivered when it can be, rather than waiting for that agent to
happen to take a turn. Neither is privileged — the lock, not the process, is the guarantee.

**Delivery has exactly one shape: an ordinary prompt.** The agent receives a message the same way it receives
anything else a human types, through the harness adapter's control channel. There is no second injection path
and specifically no hook-injected mail: a turn-boundary hook reports freshness ([[mark-active]]) and never
carries conversation. This is what makes an inter-agent message indistinguishable from a human one at the
point of arrival, which is the only thing that lets an agent answer it without knowing which it was.

A queue dies with its session's store dir. It is transport state with no evidentiary value — what was actually
said is in the log, and what an agent was shown is in its own transcript.

**Adopting this costs an ordering, and getting it backwards loses messages.** Two halves move: the sender's
backend, which learns to enqueue, and each session's materialized hook, which stops replaying. A backend that
enqueues talking to a session that still replays delivers twice — annoying, visible, harmless. The reverse —
an OLD backend, which only pokes, aimed at a session whose hook already stopped replaying — has nothing
holding the message when the poke does not land: it is recorded, reported successful, and never handed over.
Measured, not theorised. So the backend must be upgraded BEFORE a session's hook is re-materialized, which is
the opposite of the usual materialize-then-restart order, and the window lasts exactly as long as the gap
between the two.
