---
title: session-cursors
status: active
hue: 280
desc: A reader's durable place in canonical SQLite events — one cursor row per followed session, advanced monotonically and reclaimed at read time.
code:
  - spec-cli/src/session-follow.ts
related:
  - packages/session-events/src/schema.ts
  - spec-cli/src/sessions.ts
  - .spec/spexcode/.plugins/core/mark-active/mark-active.sh
---

# session-cursors

## raw source

Once supervision is a read ([[comms]]), the only durable state a watcher needs is **how far it has got**. That
is one number per (reader, event stream) pair, and it belongs in the application database beside the event store
rather than in the target's record. The application cursor table holds one row per **followed** session
([[session-follow]]), including its own id when it watches its own stream.

A position is exactly that — a reader's place in something it is watching. It is not a work list. What a
session still OWES its agent is a debt, not a position, and lives in its own queue ([[delivery-queue]]); an
earlier design spent one counter on both, which is why a session's own status lines had to be "consumed" as
though they were mail.

Nothing else records a subscription. There is no registration to install, no heartbeat to keep alive, and no
TTL to expire — a reader that dies and restarts opens the same file and resumes exactly where it stopped.

## expanded spec

A position is an **event sequence** in [[session-events]]: the greatest event sequence already consumed, so the
next read starts after that sequence and a fresh reader starts at `0`. One counter covers
both event kinds, since a follower reads a log rather than a kind.

The cursor row is advanced in the same SQLite store as canonical events. It is monotonic and transactional; there
is no cursor file, partial rewrite, or second JSON authority.

**Only the reader advances, and it is monotonic.** `advanceFollow` writes the maximum of the stored and the
offered position, so an interleaved write can leave a position too LOW — whose consequence is an event read
twice — and no path produces one too high, which would lose one. Nothing but the reader touches it: a
transport has no opinion about what has been read.

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
follows whom, so a dead target's entry disappearing IS the follow ending — nothing unregisters. A reader
watching its OWN log is the one entry that outlives every target, since its store dir is the file's own; the
file dies with the session record, like the log it indexes. A missing, empty, or unparseable file reads as
"nothing consumed" rather than failing: the honest recovery for a lost position is to re-read an event, never
to skip one.
