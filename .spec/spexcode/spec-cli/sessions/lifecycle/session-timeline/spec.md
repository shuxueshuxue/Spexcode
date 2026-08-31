---
title: session-timeline
status: active
session: 29e0d645-6173-4e13-bbaf-f008e25af769
hue: 280
desc: The session's append-only log — every authored transition and every message — is the DELIVERY itself, and the one thing about a session any process may observe without owning anything.
code:
  - packages/session-events/src/schema.ts
related:
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/session-timeline.test.ts
  - spec-cli/src/session-timeline.api.test.ts
  - spec-cli/src/session-application-timeline.test.ts
  - spec-dashboard/src/TimelineChat.jsx
---

# session-timeline

## raw source

A session's record ([[state]]) holds only its CURRENT status. Everything else a session *is* to the outside
world — what it declared, what was said to it — is a sequence of events, and a sequence belongs in a log.
Historically `timeline.ndjson`, in the session's global store dir, was that log. After the one-time application
cutover, the same public sequence is held by `session-events` in the adopter-owned SQLite database; the HTTP
projection reads that event stream and does not recreate a second ndjson feed. A message is accepted when
its bytes are in the canonical store — that is what a sender is told and what any later reader can prove. Because
the log is an application-owned durable sequence, it is the one thing about a session that any process may observe without owning anything —
which is how a supervisor, a CI, or any external orchestrator watches a fleet without being granted access to it.

What this log is NOT is a work list. It is never read to decide what a session is still owed; that debt is a
small ordered queue of its own ([[delivery-queue]]) whose resting state is empty. A record grows forever and a
debt is consumed, so binding them to one position made a session's own declarations get consumed as if they
were mail, and made "is anything outstanding?" a scan of everything that ever happened.

## expanded spec

The public event sequence has two kinds, one JSON line per event:

- **status** `{ts, status, proposal, note}` — an authored-lifecycle transition, carrying the declaration
  note **in full** (the note IS the agent's reply to a reader who can't see the pane; [[state]] already
  guarantees notes are stored whole).
- **sent** `{ts, mid, text, from, replyVia?}` — a message addressed to this session. `from` = the sending
  session, null = a human. `mid` is a unique per-message id: it is what a reader's cursor names, so the
  same message can never be injected twice and never needs a separate idempotency ledger. The newest human
  `mid` and `ts` also bind the current live execution observation; they are derived from this durable log at
  read time, never cached as server-local state. The recorded
  text is the message BEFORE mechanism inserts — hints are transport, not conversation. A caller-authorized
  merge may also store a private `dispatchReceipt` on that SAME sent line: operation plus SHA-256 request and
  payload digests, never the raw key, together with the exact already-composed transport bytes needed to
  recover a queue write lost after acceptance. Those frozen delivery bytes may include immutable string attributes
  for a structured protocol consumer; they remain private control metadata and are receipt-bound just like text and
  sender. It makes a lost-response replay find the acceptance that
  already exists.

The stored log has one private control event: **dispatch-settled** `{ts, operation, requestDigest, mid}`. A
keyed queue drain appends it after the adapter accepts that exact message and before removing the debt. Both
the receipt fields and settlement are stripped from `timelineEvents` and the public timeline API because they
are control metadata, not conversation: the public model still has exactly the two authored kinds above, and
private settlement lines do not consume its tail limit or cursor positions. This remains the same append-only
file sequence, not a second operation ledger.

The settlement is also the restart fence for that removal gap. While holding the existing queue lock, drain
matches a keyed pending entry back to its receipt by operation, request digest, message id, and frozen transport
bytes (text, sender, and optional attributes) before contacting the adapter. If that exact receipt is already settled, the queue entry is merely consumed;
if receipt identity is absent or differs, it remains owed and delivery stops fail-closed.

**One logical log may span immutable files.** Existing sessions keep their legacy `timeline.ndjson` as the
first segment. New writes append only to the highest numbered `timeline/<n>.ndjson` segment; once a segment
reaches the fixed byte bound, the writer creates the next number and never edits the old file again. File-name
order is event order; there is no mutable manifest or second history truth. Every reader joins legacy then
numbered segments as one log. The detail tail reads newest segments backward until it has its requested events,
while a full observer still sees the exact full sequence. A sealed segment may later be losslessly compressed,
but no live cursor authorizes semantic deletion: archive preserves every segment and close remains the one
physical deletion boundary.

**The append is what ACCEPTS an admissible message; the queue is what owes it.** `sendText` appends the `sent`
fact and enqueues the same message in one application transaction ([[dispatch]]), and reports success on that write.
Before that append, a resolved adapter may prove its native transport unreachable; joined with a
still-live registered agent this is a stranded worker, not a transport race, so the send fails loud without
creating a `sent` line or new debt. An unproven transport remains admissible and keeps the queue retry. This
exception preserves the dissolution of the "delivered but unconfirmed" state — the append is not itself the
handover. A keyed acceptance whose process dies before queue
publication is reconstructed from its private receipt by the same-key retry. The message reaches the agent
when [[delivery-queue]]'s drain hands it to the harness adapter as an ordinary prompt, retried until it lands;
the private settlement then makes later response replay inert even if the session has since stopped or been
archived. A public reader of this log learns what was said; only the queue says what is still owed.

**Append authored state at its write boundary.** A declaration note is conversation content, so it cannot
depend on a later sample of the mutable current-state record. Every lifecycle write compares the prior
`(status, proposal, note)` and synchronously appends a moved value after the canonical SQLite transition commits, in
whichever process owns that write. A later status may replace the current snapshot, but it can never
replace or erase the already-appended declaration event. **There is exactly one writer path** — every hook
shells to `spex internal session-*`, which is the same TypeScript writer the CLI declarations use, so no
lifecycle move reaches the canonical application without reaching this log. The log is therefore complete on its own:
no observer process, no repair tick, and no read-time deduplication of a move recorded twice.

Internal launch-readiness-pending state is not an authored lifecycle transition. While resume validates a
launched runtime, the writer compares the pending record through its frozen pre-resume public projection.
Failure or stale recovery therefore appends nothing; success clears pending and appends the one real
resting transition at the same write that first publishes the session online.

**A retired session still receives.** The record gate that refuses writes for a session whose worktree is
gone ([[sessions-core]]) governs the **lifecycle** axis only — it asserts the session cannot work, be
marked active, or be relaunched. Appending to this log is a record of something that happened, not a claim
that the session can act, so it is exempt. Sending to a retired session must leave a trace rather than
vanishing without one.

Only the AUTHORED axis is history. Liveness (offline/starting/unknown) is a present-tense probe derivation
([[state]]) — re-derived, never authored — so it stays off the durable log; surfaces show current liveness
from the board row. This is the axis split [[state]] owns, read from outside: a reader that has
only this file can learn everything a session declared and nothing about whether it is alive, and therefore
can never take an action that needs to know. The timeline dies with the session record (close sweeps the
store dir).

**Read surface: a reader holds a WINDOW over this log, and the window says what it is not showing.**
`GET /api/sessions/:id/timeline` answers oldest first, each status event carrying its composed display word
(awaiting→its proposal's label, active→working: the same vocabulary every other surface speaks). A record
that grows for a week outgrows any one read, so the read is three, over one route:

- no cursor — the newest `limit` events (default 200), answered WITH the window's own position (`offset`,
  how many earlier events exist that this window omits) and the history's size (`total`).
- `before=<position>` — the page of `limit` events ending at a position a previous answer named. This is
  how a reader walks back, and it is the only reason the earlier history is reachable at all: a tail that
  reports nothing about what precedes it strands every event before it with no way to say so and no way in.
- `since=<stamp>` — only what the log grew by. The stamp is the log's SEQUENCE, and this read costs a
  sequence range scan rather than the whole history, which is what makes a poll cheap on a long record.
  Growth beyond `limit` is answered with a whole window instead: a reader that far behind is cheaper to
  re-seat than to catch up event by event. An answer carrying `offset` is a whole window; one without it
  appends to what the reader already holds.

**A position in this history is not a sequence, and the two are never interchanged.** Events are shown in
occurrence order, but migrated legacy history holds a HIGH sequence at an EARLY time, so the log's sequence
order and its shown order genuinely differ. The stamp is therefore only ever a growth cursor — the log grows
at its end, so what is past the stamp is what is new — while walking back is addressed by position in the
shown order. Reading a window by sequence would hand back events scattered through the history.

A window also carries `priorWorking`: whether the events BEFORE it left the agent working. The derivation
that turns this log into a conversation carries that word forward across the events that do not repeat it,
so a window opening mid-stretch needs what the earlier events already said or it drops the stretch of work
it opened inside.

**Reply-channel readability belongs to the target session, not the sending surface.** One server-side prompt
composition seam receives the raw prompt, the target session, and an optional explicit `replyVia`; it alone
decides the effective reply channel and the actual delivered text. An explicit value wins. With no value, a
target whose resolved harness adapter declares `headless:true` defaults to `replyVia:"note"`, while a
pane-backed target keeps the ordinary terminal reply. The launch prompt, the one input route (and therefore
`spex session send`), and merge dispatch all pass through this seam. No caller appends a reply insert itself.

For an effective note reply, that seam appends `withNoteReplyHint`. The insert is transport guidance only:
the agent writes the actual declaration by executing the external `spex session <verb> --note <text>` CLI,
and lifecycle hooks only delimit or remind the agent at turn boundaries; hooks never carry the note data.
Because the declaration call is the reply transport rather than task work, the insert explicitly requires it even when the
raw message forbids tools or asks for output only. A simple answer awaiting the next human message gets the concrete
`spex session ask --note "<complete reply>"` action; a genuinely done or parked turn instead puts the same complete reply
on that truthful declaration. Printing a normal final answer alone does not deliver it, and a generic stop-gate auto-note
does not satisfy the reply.
The phrase has one owner here beside the other delivery inserts. The timeline records the raw conversational
text without inserts and `replyVia:"note"` whenever note is the effective channel (absence means terminal),
so restart-safe channel history describes where a reply was actually readable rather than which caller
happened to set a flag.

**The reply-channel signal is symmetric — changing readability must not leave notes sticky.** The note insert
declares itself per-message, and an effective note→terminal transition gets an explicit counter-insert: a
human send whose effective channel is terminal and whose *previous human* send used note
(`lastHumanSendVia`, derived from the durable sent log — no new state, restart-safe; agent-to-agent sends
neither set nor clear it, they say nothing about where the human reads) is delivered wrapped in
`withTerminalReplyHint` — "the sender reads your terminal again; reply in normal output, not in `--note`".
Fired exactly once: the transition send itself is recorded without the note marker, so the next terminal send ships bare.
Without the counter-signal an agent that note-replied a few times keeps note-replying from context inertia
long after the human left the phone — the failure that made entering the phone surface feel irreversible.
