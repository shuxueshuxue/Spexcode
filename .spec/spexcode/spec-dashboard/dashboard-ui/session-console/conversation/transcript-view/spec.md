---
title: transcript-view
status: active
hue: 280
desc: The one transcript renderer — a closed seam's history and the open seam's live tail are the same normalized payload, drawn by the same components; "live" only adds the truth that a call without a recorded result is still running.
code:
  - spec-dashboard/src/Transcript.jsx
related:
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/LiveTail.jsx
  - spec-dashboard/src/toolVocabulary.js
  - spec-dashboard/src/conversationItems.js
---

# transcript-view

[[conversation]] legislates how a transcript reads — the person quoted, the agent as the page, a tool call as a
sentence, the work segment folded behind its answer, output in a quiet well on the page's own ladder. This node
holds that grammar as ONE set of components, because two surfaces read the same payload: a closed seam's
history, fetched once for its interval, and the open seam's live tail, streamed as the agent works
([[message-stream]]). Both are the adapter's normalized turns ([[transcript-reader]]), and both are drawn here —
`Quote`, `TimelineRichText`, the tool sentence, the tool run, the segment fold, the payload — so a change to how
a call reads changes it in history and in the tail at once, and neither surface can drift into its own dialect.

**Live adds exactly one truth.** A tool call whose result the harness has not recorded yet carries no `output`;
a LIVE reading draws that call as running — a small spinner and the word beside the sentence — and a run that
holds a running call is marked so its fold can say it. A closed interval never says running: a stretch that
ended before a result was written is history, not something still happening, so the same payload read as
history draws the same call as a plain sentence.

**An expanded call shows both sides of the record.** Its original `input` is rendered alongside the recorded
output, so parameters remain inspectable even when a live call has no result yet. A withheld live result still
fetches its body on demand; the input never waits for that fetch.

**The work in progress never folds.** Folding is for process that already produced an answer — collapse the
process, keep the result. The last segment of a LIVE payload is what is happening now: its calls after the newest
prose, or all of its calls while there is no prose yet, draw as sentences whatever their number, in the collapsed
tail and in the expanded interval alike; neither the segment fold nor a turn's own run fold applies to them,
because a `7 tool uses ›` row under a seam line that already says `7 tool uses ›` is a count that shows nothing,
twice. They fold the moment the agent speaks — the prose that follows makes them the process behind that answer
— and a closed interval reads the same calls as history, folded by the ordinary rule. Consecutive tool-only
turns are ONE list of calls: the harness draws a turn boundary around every call it makes, and that boundary is
not a paragraph break, so seven calls in seven turns sit at the same list spacing as seven calls in one.

**A seam draws the agent's work, not the conversation's messages.** Every message is already a row on the
record ([[conversation-items]]) — the launch prompt, each `spex session send`, each peer reply — so a user turn
inside a seam's transcript is only a boundary: it marks where a stretch of the agent's work begins and is never
drawn. The seam renders assistant prose and tool calls alone, with no opener to locate and no text to match. The
two layers never carry the same message, so there is nothing to reconcile and nothing to duplicate — and no
intervening event (a `queued` row, a status note) between the record's message and its seam can defeat a dedup
that no longer exists. A message typed directly into a harness, not through SpexCode, is not part of the
record's conversation and is not surfaced here; the agent's response to it still renders as work. The one text
elision that remains is the live tail's alone — the agent's newest prose against the note it just declared, the
record having drawn that note one row above ([[message-stream]]) — and its `alreadySaid` helper lives here as the
shared text test, used by that one face.

**Disclosure is keyed to the transcript's own ids** — a tool's id, a run's first tool, a segment's first turn —
never to render position, so a live refresh of the same interval keeps what the reader opened, and a payload
for a different interval starts closed by construction. The person's turn inside a transcript strips the
`spex session send` envelope the same way the outer conversation does, and shows the peer's name it carries.
