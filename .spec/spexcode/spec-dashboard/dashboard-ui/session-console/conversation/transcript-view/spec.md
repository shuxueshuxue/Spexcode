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

**Disclosure is keyed to the transcript's own ids** — a tool's id, a run's first tool, a segment's first turn —
never to render position, so a live refresh of the same interval keeps what the reader opened, and a payload
for a different interval starts closed by construction. The person's turn inside a transcript strips the
`spex session send` envelope the same way the outer conversation does, and shows the peer's name it carries.
