---
title: self-launch-yatu
status: active
hue: 280
desc: The synced product proof of the self-launch loop — real init, materialize, and dispatcher; registration into a ready store only; a bare-address send with no backend; and all three inbox shapes consuming at-most-once with no resident process.
code:
  - scripts/self-launch-yatu.mjs
related:
  - .spec/spexcode/session-runtime/self-launch-entry/spec.md
  - .spec/spexcode/spec-cli/sessions/comms/inbox/spec.md
  - .spec/spexcode/.plugins/core/session-listen/spec.md
  - spec-cli/src/session-inbox.cli.test.ts
---
# self-launch-yatu

This node owns the executable proof that the self-launch path works the way a person who started their own harness
would meet it, not the way a unit test would arrange it. The script builds a real project, runs the real `spex init`
and `spex materialize`, and fires the real `dispatch.sh` — so the registration hook it exercises is the one a fresh
adopter's manifest binds, on the one event it is bound to.

Every assertion is one the loop could fail. A `SessionStart` before any store exists must register nothing and create
nothing. After a ready store exists, the same event must leave the native session id as a protocol address with no
application row, and a second firing must change nothing. A plain-shell `spex session send` to that bare address, with
the API pointed at a port proven closed, must exit zero, say on stderr that the message is queued for the receiver, and
leave exactly one pending message; a send to an address nobody registered must be refused without minting that
address. The three inbox shapes are then each driven as their own kind of process: `dequeue` returns the message
verbatim and leaves the queue empty; `wait-dequeue` is observed still blocking before a send and exits zero with that
message after it; `stream-dequeue` turns three sends into three lines in order, does not exit on its own, and ends
cleanly on `SIGTERM`. Before, between, and after those steps a residency probe that has just seen a canary of this run
finds no process of the run alive.

The proof stays honest about what it reaches for. The closed port is taken from a server the script itself just
closed, because the default API URL is the host's live backend and fetch's own bad-port list fails without the
connection-refused signal the CLI's offline branch keys on — a fixed small port would have measured the wrong
refusal. The script is the successor of the M4 self-launch YATU, whose delivery assertions a later decision outdated;
it is listed here so that a change to the loop it proves is a change to a governed file, not to an orphan.
