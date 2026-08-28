---
title: message-stream
status: active
hue: 280
desc: The live tail is the open seam's collapsed face — the current turn derived in the browser from the seam's streamed transcript payload, drawn in the conversation's own grammar; TimelineChat never reads a native transcript or a second projection.
code:
  - spec-dashboard/src/LiveTail.jsx
related:
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-cli/src/session-transcript.ts
  - spec-dashboard/test/live-tail.e2e.mjs
---

# message-stream

`TimelineChat` remains the session's durable conversation: [[session-timeline]] is still the only record of what
was said and declared. A harness transcript is neither a second conversation nor a durable SpexCode record; it is
an adapter-local observation read on demand ([[transcript-reader]]) and never copied into the record.

**The live tail IS the open seam.** A working record ends in one open seam ([[conversation]]); while the session
is live, that seam subscribes to its interval's transcript stream ([[session-transcript]]) — `[from, now]`, the
stretch the agent is working in, advanced by the server only when the native thread changed and sent as what
changed: the whole interval once, then only the turns that are new or changed, which the subscriber merges by
turn id into the one complete payload the renderers read, so nothing that draws a turn knows the wire is
incremental. A live frame carries no tool output bodies — a recorded result is `null` on the wire with its size
— and a call opened in the seam fetches its body once for that session and interval, remembered while the
session is on screen; a running call still has no output field at all. The seam then has two faces of ONE
payload. Collapsed, it draws the CURRENT TURN — the turns after the newest human
message in the interval (or the whole interval when the stretch was opened by the agent itself) — as its live
tail, directly beneath the `working · 4m 12s` line. Expanded, it draws the whole interval in full — without
re-quoting the message that opened it, which the record already quotes directly above ([[transcript-view]]) — and
the collapsed face steps aside, so nothing is ever drawn twice. There is no separate row after the seam, no card, no
door, no pop-out, and no second server projection of "the latest note and its steps": the browser derives the
current turn from the same normalized turns the history reads in.

**The compact face shows "now", not the whole turn.** It takes the newest prose in the current turn and every
call after it — the process that produced earlier prose has already folded into the history the expanded seam
keeps — and draws them in the transcript's own grammar: prose as the page at the prose size, each call as the
same tool sentence the folded history uses. Before any prose, the calls themselves are the news: a turn that
opens with tools and no words (Claude Code's usual shape) is not blank, it is working. Those calls never fold,
whatever their number: the seam line above already counts them, and a fold's one job — hiding the process behind
an answer — has no object while there is no answer yet ([[transcript-view]]); they leave the compact face the
moment the agent speaks, when they become that answer's history. What reads as live is a
caret and a spinner, and nothing else: the caret sits INLINE at the end of the newest prose's last line, only
while that prose is the newest thing in the turn — once a call follows it the words are finished and a caret
blinking on its own line under them, above a tool row, would mark nothing — and the spinner sits on a running
call, a call being running exactly while the harness has recorded no result for it; reduced motion stills both. Output stays folded until asked, each
call opening inline and independently; a refresh of the same interval keeps what the reader opened, because
disclosure is keyed to the transcript's own ids, and a new seam starts closed.

**The tail says nothing the record already said.** The moment the agent declares its newest prose as its status
note, the durable timeline draws it as a message one row above; the same sentence twice — once as history, once
as "now" — is the duplication a reader notices first. So that prose is elided when the newest agent message on
the record already carries it (either side may be the other's prefix, since the backend clips a note at 240
characters), and a tail whose prose is elided and whose calls are all done draws nothing: the record has the
words and the seam has the history.

**The tail is there when the page is.** Two things used to make the open seam blink: coming back to a
Conversation tab cleared the tail and waited for the reopened stream's first frame, and a first visit painted
the record's rows a few hundred milliseconds before the first frame, so the tail landed in a second paint that
pushed the page. Now the last payload stays held while the tab is away — the stream closes, because a hidden
pane reads nothing, but returning draws the tail at once from what was last seen and the reopened stream's
first `full` frame replaces it in place; it is cleared only when the seam itself changes. And a session's FIRST
paint waits for its open seam's first frame — bounded at 600 ms, so a silent stream still paints — and then
paints rows and tail together; the rows never wait again after that, so a later seam draws into a page that
is already on screen.

The renderer never knows a harness id, a transcript path, an envelope schema, or reasoning text — it paints
normalized turns and nothing else, and adding a harness changes no rendering branch here. Pane-backed adapters
keep their real terminal as the full live surface; this face is additive to the Conversation, never a
raw-process door or an alternate terminal. A stream frame that carries an error shows the seam's unavailable
line in place; an absent source (the thread has not started writing) draws nothing until it does.
