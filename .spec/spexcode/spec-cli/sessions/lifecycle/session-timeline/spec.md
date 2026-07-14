---
title: session-timeline
status: active
session: 29e0d645-6173-4e13-bbaf-f008e25af769
hue: 280
desc: The persisted per-session interaction history — every authored status transition (with its full note) and every delivered prompt, timestamped in timeline.ndjson — recorded by ONE store observer so even the sed-writing shell hook is covered; what a terminal-free surface renders as the conversation.
code:
  - spec-cli/src/session-timeline.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/layout.ts
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

**One observer, not writer instrumentation.** The lifecycle has a writer the TS layer never sees: the
mark-active hook value-replaces status/proposal/note with pure-shell sed. Instrumenting writers would always
miss it, so the recorder (serve-process only, `superviseTimeline`) OBSERVES the store — an fs.watch on the
sessions root, debounced, backstopped by a slow reconcile tick — and appends whatever (status, proposal,
note) moved since last seen. Every writer is covered by construction; granularity is the debounce window,
same as the board's. On restart each id re-seeds from its persisted last status line, so an unchanged
session appends nothing and a moved one appends once, with an honest observed-now timestamp.

Only the AUTHORED axis is history. Liveness (offline/starting/unknown) is a present-tense probe derivation
([[state]]) — re-derived, never authored — so it stays off the durable log; surfaces show current liveness
from the board row. The timeline dies with the session record (close sweeps the store dir), like comms.

Read surface: `GET /api/sessions/:id/timeline` — the tail (default 500), oldest first, each status event
carrying its composed display word (awaiting→its proposal's label, active→working: the same vocabulary
every other surface speaks). Write surface for the terminal-free sender: the one input route accepts
`replyVia:"note"`, and the server appends `withNoteReplyHint` to the delivery — the insert that tells the
agent its reader can only see declaration notes, so the complete reply belongs in `--note`. The phrase
lives server-side, beside withSenderHint, so every surface (desktop later, too) opts in with the same flag.
