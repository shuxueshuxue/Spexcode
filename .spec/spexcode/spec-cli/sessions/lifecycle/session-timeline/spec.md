---
title: session-timeline
status: active
session: 29e0d645-6173-4e13-bbaf-f008e25af769
hue: 280
desc: The session's append-only log — every authored transition and every message — is the DELIVERY itself, and the one thing about a session any process may observe without owning anything.
code:
  - spec-cli/src/session-timeline.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/session-timeline.test.ts
  - spec-dashboard/src/TimelineChat.jsx
---

# session-timeline

## raw source

A session's record ([[state]]) holds only its CURRENT status. Everything else a session *is* to the outside
world — what it declared, what was said to it — is a sequence of events, and a sequence belongs in a log.
`timeline.ndjson`, in the session's global store dir, is that log: the **record**, and the **conversation** a
terminal-free surface renders, which are the same sequence read for two purposes. A message is accepted when
its bytes are in this file — that is what a sender is told and what any later reader can prove. And because
the log is only files, it is the one thing about a session that any process may observe without owning
anything — which is how a supervisor, a CI, or any external orchestrator watches a fleet without being
granted access to it.

What this log is NOT is a work list. It is never read to decide what a session is still owed; that debt is a
small ordered queue of its own ([[delivery-queue]]) whose resting state is empty. A record grows forever and a
debt is consumed, so binding them to one position made a session's own declarations get consumed as if they
were mail, and made "is anything outstanding?" a scan of everything that ever happened.

## expanded spec

One JSON line per event, two kinds:

- **status** `{ts, status, proposal, note}` — an authored-lifecycle transition, carrying the declaration
  note **in full** (the note IS the agent's reply to a reader who can't see the pane; [[state]] already
  guarantees notes are stored whole).
- **sent** `{ts, mid, text, from, replyVia?}` — a message addressed to this session. `from` = the sending
  session, null = a human. `mid` is a unique per-message id: it is what a reader's cursor names, so the
  same message can never be injected twice and never needs a separate idempotency ledger. The recorded
  text is the message BEFORE mechanism inserts — hints are transport, not conversation.

**One logical log may span immutable files.** Existing sessions keep their legacy `timeline.ndjson` as the
first segment. New writes append only to the highest numbered `timeline/<n>.ndjson` segment; once a segment
reaches the fixed byte bound, the writer creates the next number and never edits the old file again. File-name
order is event order; there is no mutable manifest or second history truth. Every reader joins legacy then
numbered segments as one log. The detail tail reads newest segments backward until it has its requested events,
while a full observer still sees the exact full sequence. A sealed segment may later be losslessly compressed,
but no live cursor authorizes semantic deletion: archive preserves every segment and close remains the one
physical deletion boundary.

**The append is what ACCEPTS a message; the queue is what owes it.** `sendText` appends the `sent` line and
enqueues the same message in one hold of the session's record lock ([[dispatch]]), and reports success on that
write. Acceptance therefore never depends on the transport, which is what dissolved the "delivered but
unconfirmed" state — but it is not itself the handover. The message reaches the agent when
[[delivery-queue]]'s drain hands it to the harness adapter as an ordinary prompt, retried until it lands. A
reader of this log learns what was said; only the queue says what is still owed.

**Append authored state at its write boundary.** A declaration note is conversation content, so it cannot
depend on a later sample of the mutable current-state record. Every lifecycle write compares the prior
`(status, proposal, note)` and synchronously appends a moved value after the new `session.json` lands, in
whichever process owns that write. A later status may replace the current snapshot, but it can never
replace or erase the already-appended declaration event. **There is exactly one writer path** — every hook
shells to `spex internal session-*`, which is the same TypeScript writer the CLI declarations use, so no
lifecycle move reaches `session.json` without reaching this log. The log is therefore complete on its own:
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

Read surface: `GET /api/sessions/:id/timeline` — the tail (default 500), oldest first, each status event
carrying its composed display word (awaiting→its proposal's label, active→working: the same vocabulary
every other surface speaks).

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
