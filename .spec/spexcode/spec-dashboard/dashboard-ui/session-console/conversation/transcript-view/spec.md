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

**The work in progress never folds.** Folding is for process that already produced an answer — collapse the
process, keep the result. The last segment of a LIVE payload is what is happening now: its calls after the newest
prose, or all of its calls while there is no prose yet, draw as sentences whatever their number, in the collapsed
tail and in the expanded interval alike; neither the segment fold nor a turn's own run fold applies to them,
because a `7 tool uses ›` row under a seam line that already says `7 tool uses ›` is a count that shows nothing,
twice. They fold the moment the agent speaks — the prose that follows makes them the process behind that answer
— and a closed interval reads the same calls as history, folded by the ordinary rule. Consecutive tool-only
turns are ONE list of calls: the harness draws a turn boundary around every call it makes, and that boundary is
not a paragraph break, so seven calls in seven turns sit at the same list spacing as seven calls in one.

**The transcript says nothing the record already said.** The interval's first human turn is the message that
opened the seam — the record quotes it one row above — so it is not quoted again inside; a human turn the record
does not carry (typed into the harness itself) still is. The test is a prefix match either way over squashed
whitespace, the same one the live tail applies to the agent's newest prose against the record's newest message
([[message-stream]]); it lives here so both faces elide by one rule.

**Disclosure is keyed to the transcript's own ids** — a tool's id, a run's first tool, a segment's first turn —
never to render position, so a live refresh of the same interval keeps what the reader opened, and a payload
for a different interval starts closed by construction. The person's turn inside a transcript strips the
`spex session send` envelope the same way the outer conversation does, and shows the peer's name it carries.
