---
title: session-cursors
status: active
hue: 280
desc: A reader's durable place in a log — one `cursors.json` per session holding its own inbox position plus one entry per followed session, advanced monotonically and reclaimed at read time.
code:
  - spec-cli/src/session-cursors.ts
related:
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/sessions.ts
  - .spec/spexcode/.plugins/core/mark-active/mark-active.sh
---

# session-cursors

## raw source

Once delivery is an append and supervision is a read ([[comms]]), the only durable state either side needs is
**how far a reader has got**. That is one number per (reader, log) pair, and it belongs beside the reader's own
record rather than inside the log it points at — a log is written by whoever sends, and a position is owned by
whoever reads. `cursors.json`, in the reader's global store dir, holds all of its positions: its **inbox** (its
place in its OWN log — the mail it has been shown) and one entry per **followed** session ([[session-follow]]).

Nothing else records a subscription. There is no registration to install, no heartbeat to keep alive, and no
TTL to expire — a reader that dies and restarts opens the same file and resumes exactly where it stopped.

## expanded spec

A position is an **event index** into [[session-timeline]]'s `timeline.ndjson`: the number of lines already
consumed, so `pos` is the index of the next unread event and a fresh reader starts at `0`. One counter covers
both event kinds; the inbox reader consumes every line and only *shows* the `sent` ones, so a session's own
declarations can never come back to it as mail.

The file is written whole, atomically (temp + rename), one field per line — the same shape as the session
record, and for the same reason: the mark-active hook reads its inbox position in **pure shell**, and a
whole-line match is exact where a value regex is not.

**Only the reader advances, and it is monotonic.** `advanceInbox` writes the maximum of the stored and
offered position after the turn-boundary hook has emitted unread messages. A poke never advances this
cursor: reaching a local socket write cannot prove that the target parsed it. A lost or replayed poke thus
leaves the line for the reader, whose one monotonic cursor is the sole authority for whether it has been
shown. A stale read can only leave a position too LOW, whose consequence is a message shown twice; no path
produces a position too high that would lose one.

**A reader consumes EDGES, not lines.** The unread slice a follower acts on drops any status event whose
`(status, proposal, note)` equals the last status that reader already saw — `X → X` is not a transition. This
is not tidiness: the log is append-only and permanently holds runs of identical status lines written before
the timeline observer was retired, when every stray `spex serve` process watched the same store and
re-recorded each real move (one measured transition landed as six lines inside 184ms). Those bytes are
history and are never rewritten, so the *read* is where an edge is decided — by comparing VALUES, never
adjacency, and never against only the slice being read: a duplicate straddling the cursor boundary would
otherwise read as a fresh move on the very next tick. A dropped duplicate is still **consumed** — the cursor
advances past everything it read, so the same bytes are never re-examined. A reader that STOPS on one event
instead of draining the slice ([[session-follow]]'s take-one wait) needs the opposite guarantee, so the slice
also names each event's absolute index: that reader advances to exactly the event it took, and the moves
behind it in the same slice stay unread rather than being swallowed by the stop.

**Expiry is a read-time consequence, never a timer.** Reading the file drops every followed entry whose target
store dir no longer exists, and the next write persists that reckoning. A cursor is the whole record of who
follows whom, so a dead target's entry disappearing IS the follow ending — nothing unregisters. The inbox
entry is the reader's own and is never reclaimed; the file dies with the session record, like the log it
indexes. A missing, empty, or unparseable file reads as "nothing consumed" rather than failing: the honest
recovery for a lost position is to re-show a message, never to skip one.
