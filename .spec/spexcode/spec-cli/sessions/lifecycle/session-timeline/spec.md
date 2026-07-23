---
title: session-timeline
status: active
session: 29e0d645-6173-4e13-bbaf-f008e25af769
hue: 280
desc: The persisted per-session interaction history — every authored status transition (with its full note) and every delivered prompt, timestamped in the append-only timeline.ndjson; what a terminal-free surface renders as the conversation.
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

A session's record ([[state]]) holds only its CURRENT status; history lived nowhere. But a surface with no
terminal — the phone face ([[mobile-ui]]), or any future no-pane client — has exactly one thing to show a
human: *what happened, when, and what the agent said at each stop*. So the lifecycle gets a durable history:
`timeline.ndjson` in the session's global store dir, one JSON line per event, two kinds —

- **status** `{ts, status, proposal, note}` — an authored-lifecycle transition, carrying the declaration
  note **in full** (the note IS the agent's reply to a reader who can't see the pane; [[state]] already
  guarantees notes are stored whole).
- **sent** `{ts, text, from, replyVia?}` — a confirmed prompt delivery (every one flows through sendText:
  human input, `spex session send`, the merge dispatch). `from` = the sending session, null = a human.
  The recorded text is the message BEFORE mechanism inserts — hints are transport, not conversation.

**Append authored state at its write boundary; observe the writer outside TypeScript.** A declaration note
is conversation content, so it cannot depend on a later sample of the mutable current-state record. Every
TypeScript lifecycle write compares the prior `(status, proposal, note)` and synchronously appends a moved
value after the new `session.json` lands. A later status may replace the current snapshot, but it can never
replace or erase the already-appended declaration event.

The lifecycle also has a writer the TypeScript layer never sees: the mark-active hook value-replaces those
three fields with pure-shell sed. The serve-process `superviseTimeline` therefore remains as the coverage and
repair observer for external writes — an fs.watch on the sessions root, debounced, backstopped by a slow
reconcile tick. A direct append and an observation may both record one move; the read's adjacent-duplicate
fold makes that harmless. On restart each id re-seeds from its persisted last status line, so an unchanged
session appends nothing and a moved one appends once, with an honest observed-now timestamp. The mutable
record is the present-state projection; `timeline.ndjson` is the append-only conversation history.

Only the AUTHORED axis is history. Liveness (offline/starting/unknown) is a present-tense probe derivation
([[state]]) — re-derived, never authored — so it stays off the durable log; surfaces show current liveness
from the board row. The timeline dies with the session record (close sweeps the store dir), like comms.

Read surface: `GET /api/sessions/:id/timeline` — the tail (default 500), oldest first, each status event
carrying its composed display word (awaiting→its proposal's label, active→working: the same vocabulary
every other surface speaks). The read FOLDS adjacent status lines with identical (status, proposal, note)
into their first: the direct writer and observer, or two serve processes observing one store (a throwaway
worktree/eval serve beside the live one), can append a single record move twice — the log stays append-only
and duplicates die at read time, the same read-aggregation stance as the board.

**Reply-channel readability belongs to the target session, not the sending surface.** One server-side prompt
composition seam receives the raw prompt, the target session, and an optional explicit `replyVia`; it alone
decides the effective reply channel and the actual delivered text. An explicit value wins. With no value, a
target whose resolved harness adapter declares `headless:true` defaults to `replyVia:"note"`, while a
pane-backed target keeps the ordinary terminal reply. The launch prompt, the one input route (and therefore
`spex session send`), and merge dispatch all pass through this seam. No caller appends a reply insert itself.

For an effective note reply, that seam appends `withNoteReplyHint`. The insert is transport guidance only:
the agent writes the actual declaration by executing the external `spex session <verb> --note <text>` CLI,
and lifecycle hooks only delimit or remind the agent at turn boundaries; hooks never carry the note data.
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
