---
title: delivery-queue
status: active
hue: 280
desc: What a session is still OWED — a small ordered queue of messages not yet handed to its agent, drained by adapter insert, empty when nothing is owed.
code:
  - packages/session-core/src/delivery-queue.ts
related:
  - spec-cli/src/delivery-lock.ts
  - spec-cli/src/sessions.ts
  - packages/session-core/src/session-timeline.ts
  - spec-cli/src/index.ts
  - packages/session-core/src/delivery-queue.test.ts
---

# delivery-queue

> Migration boundary: this file queue is a legacy adapter for records that have not crossed the SQLite
> application fence. Canonical sessions use `session-application`'s protocol queue and never read or write
> `pending.json`; the canonical CLI queue is application-owned and the legacy file is migration input only.

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

A queue is only ever filled by an enqueue, so nothing is owed that was not sent, and a log stays history no
matter how many thousands of lines it grows to. A terminal sender is the one exception to "owed until taken":
closing a session revokes its **unhanded** outbound debt everywhere, because a dead coordinator must not regain
control merely because a target was temporarily unavailable.

## expanded spec

The canonical application queue, in the session database, is an ordered list of messages that have been recorded
but not yet handed to the agent. `pending.json` is migration input only, never a live queue. Each canonical entry is
self-contained — the message id, the sender, and the text exactly as it will be handed over, mechanism inserts
already composed in ([[session-timeline]] owns that seam;
the log keeps the raw conversational text, the queue keeps the transport form). A caller-keyed entry also
carries the operation plus request digest that its private timeline receipt names, never the raw key. A protocol
producer may add immutable string attributes; keyed drain compares them with the same frozen receipt bytes before
calling the consumer, so structured historical facts cannot silently drift to a newer read-model state. The ordinary
delivery path never reads the log. Only a retry of that keyed acceptance reconciles the two durable
sides: if its receipt exists without its exact message id in the queue, it restores the receipt's frozen
transport bytes under this queue's lock. Transport state and record remain independent for every ordinary
read: history could be trimmed, archived, or read by anyone without changing what is owed. An empty queue is
deleted rather than stored as an empty list, so "is anything owed?" is the existence of a file.

**The enqueue rides the append.** `sendText` records the `sent` line and enqueues the same message inside one
hold of the session's record lock ([[dispatch]]); a keyed acceptance additionally holds this queue's lock, in
the common record-then-delivery order. A proven-unreachable adapter transport joined to a still-live registered
agent is the one pre-append refusal: that session is stranded and new text must name the cause, debt count, and
raw-key bypass instead of creating more unclaimable debt. A transient/unproven probe, or a dead worker that a
later resume can address, keeps the ordinary acceptance rule: the queue is what the accepted message is owed,
not an immediate-poke receipt. Queue acceptance does not make the target `active`: lifecycle freshness changes
only after the exact message is handed to the native runtime and removed from this queue. The record is written first — a crash between the two
writes leaves a message that is visible but undelivered, never one delivered but unrecorded. For the keyed
merge intent, the receipt carries the already-composed transport bytes, so the same request reconstructs that
one missing debt rather than mistaking the durable receipt for completed delivery.

**Draining is claim-insert-remove, under the queue's own lock.** A delivery pass takes the queue lock, and for
each entry in order composes the prompt through the one seam ([[session-timeline]]) and hands it to the
resolved adapter. A confirmed insert removes that entry; an insert the adapter refuses, cannot reach, or that
throws ENDS the pass with the entry still queued, and everything behind it stays behind it — order is a
property of a conversation, so a message is never skipped to deliver a later one.

The lock spans the insert deliberately, and it is NOT the record lock: the record lock cannot span an adapter
call (a native turn runs lifecycle hooks that re-enter the record writer, which is a deadlock), while nothing
in the delivery path takes this one. Holding it across the insert is what makes "claim" real, so two processes
draining the same session at the same moment cannot both hand over the same message. A keyed entry that the
adapter accepts appends its private timeline settlement before this lock removes the debt. That settlement is
what distinguishes "receipt exists because it was accepted" from "receipt exists and the agent already saw
it" after a restart. Before any adapter call, drain reconciles a keyed head against its exact receipt. A matching
settled receipt consumes the leftover debt without handing it over again; missing receipt, different message id,
or different frozen transport bytes refuses and leaves the head in place. Thus process death between settlement
and removal cannot duplicate an agent prompt, while corrupt authority can never silently discard one. A later
replay of the response therefore never needs to reopen the session.

**Close revokes a sender, not history.** A successful close writes a durable sender-revocation marker outside
the closing session's store (which is about to disappear). Agent-to-agent dispatch takes the claimed sender's
record lock as well as the target's before it appends, while close keeps that same sender lock through record
removal and marker publication. Thus a send either finished before close began and becomes revocable debt, or
observes the marker and never records a new message; this holds across every backend sharing the store. A drain
that sees a revoked sender removes that queue entry without calling the adapter, then continues so dead debt
cannot block later mail. The target's `sent` history is intentionally unchanged: it is evidence that the message
was accepted, not permission to hand it over after the sender died. An adapter insert already claimed before
the close/reparent transaction obtains the queue lock may arrive before that operation returns; no unhanded
entry from that sender may arrive after a successful close returns.

**Supervisor transfer revokes only former control debt.** Reparent holds each moved child's record lock, its
former parent's sender lock, and the moved queues' delivery locks in one ordered transaction. It replaces the
parent/watch relation and removes unhanded entries whose `from` is that former parent, rolling both queue and
record bytes back if a later write fails. Ordinary peer messages and the target's history remain intact. This
is deliberately narrower than an authorization system: a still-live former session can explicitly send a new
peer message after reparent, but a command it had already queued cannot cross the supervisory handoff.

**Any process may drain; one process is expected to.** A pass costs nothing when the queue is empty, so
`sendText` runs one immediately in whatever process accepted the message — that is what puts the text in a
live agent's current turn instead of at the next sweep tick. The retry belongs to the `spex serve` that owns the project root:
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
