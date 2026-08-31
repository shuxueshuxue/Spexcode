---
title: conversation items
status: active
hue: 284
desc: The one derivation from a session's timeline to what the Conversation shows — messages, seams and events partitioning the session's time, with the agent's working state carried across the events that do not repeat it, so a working record always ends in an open seam.
code:
  - spec-dashboard/src/conversationItems.js
related:
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/conversationItems.test.mjs
  - spec-dashboard/test/fixtures/conversation-tail.scenarios.mjs
  - spec-dashboard/test/conversation-working-tail.e2e.mjs
  - spec-cli/src/sessions.ts
---

# conversation items

[[conversation]] renders three things in wire order — messages, seams, events — and this module is the one
place that decides which stretch of a session's timeline is which. It is a pure function of the timeline
events and the word the events BEFORE them left the agent on; it knows nothing of the DOM, the footer,
or liveness.

**The items partition the session's time, and no stretch of work is ever dropped.** Every instant from the
first event onward belongs to exactly one item: a QUOTE (a `sent` event; the addressing envelope
`spex session send` appends is stripped here and its sender kept, through the transcript package's own
`spexEnvelope` row — the same row a quoted turn inside a transcript is read with, so the two never disagree), a SAY (a status event carrying a note,
or any non-working status), an EVENT (`error`, `corrupt` — an instant, not a phase), or a SEAM — an interval
in which the agent said nothing and worked, which owns the transcript for exactly that interval.

**A window is not the whole history.** The reader holds the newest events of a session that may hold
thousands ([[session-timeline]]), so this derivation can be handed a stretch that begins in the middle of the
agent's work. The word the earlier events already said comes in with the window: without it the derivation
starts from `not working` and silently drops the stretch it opened inside — the one seam whose transcript the
reader most likely came for. What the window is told, it carries forward exactly as it carries its own.

**The agent's working state is carried, not re-read.** The record says the agent is working only once: the
backend's status transition is idempotent (`markState` in `sessions.ts` writes no event when the status,
proposal and note are unchanged), so a human message, a peer message, or a note that lands on an
already-active agent leaves no status event behind it. The derivation therefore tracks the record's last
word itself. A bare `working` event opens a seam (or continues the open one — a run of bare `working`
events is one seam). Any other event closes the open seam at its instant, becomes its item, and — if the
record's last word is still `working` — opens a new seam at that same instant, because a working agent is
working on what was just said from then on.

**The theorem the page relies on**, true by construction: if the record's last word is `working`, the last
item is an open seam, and otherwise no item is open. Corollaries: the live tail of a working session is
always present and disclosable no matter how many messages were sent into the turn; a message or note that
landed on a working agent mid-history is followed by a `worked …` seam whose transcript can be opened; a
message that lands on an agent that is not working claims no work. **The open tail has no end here.** Its end is the reader's present, and the present moves every second; a
moving number inside this derivation meant the whole conversation was rebuilt on each tick to draw one line
of text. So an open seam states no end, and whoever needs an interval for it — the transcript read that
addresses `[from, to]` — says which present it ends at. The seam's identity is its start, so the reader's
disclosure survives whatever end is chosen; a collapsed seam still reads nothing; and an EXPANDED live seam
does not depend on this end at all, because it reads its interval from the stream ([[message-stream]]).

The converse is not claimed: an open seam at the tail does not mean the agent is alive — the footer's
liveness decides whether that seam ticks or reads the bare word `working` ([[conversation]]).

The shared scenario table in `test/fixtures/conversation-tail.scenarios.mjs` is read by two instruments —
the unit test straight off this function, and the browser run off the rendered Conversation — so the
derivation and the surface are measured against one statement of what the reader is owed; the property
test walks the status machine's whole vocabulary in random order and checks the theorem on each.
