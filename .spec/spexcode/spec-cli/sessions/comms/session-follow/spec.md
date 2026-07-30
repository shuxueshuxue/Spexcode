---
title: session-follow
status: active
hue: 280
desc: Supervision is FOLLOWING a log, not polling a board — a durable cursor per followed session, `wait` as the one-shot take-the-next-event, `watch` as the stream, and zero control-plane cost per observer.
code:
  - spec-cli/src/session-follow.ts
related:
  - spec-cli/src/session-cursors.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/session-follow.test.ts
  - spec-cli/src/follow-cli.api.test.ts
---

# session-follow

## raw source

A supervisor asks one question: *tell me when something happens to the agents I care about.* The old answer
polled the backend's derived board every couple of seconds and inferred transitions by comparing two
samples. Everything wrong with it follows from that one choice. Two moves inside one interval collapse into
one, so information is genuinely **lost**. The poll's cost is a full board build — one tmux spawn plus a
control-plane probe for **every live session** — so the probe rate grows as *observers × sessions*, and on
the harness whose control channel keeps a single connection, every probe is a chance to kick a delivery in
flight. A mechanism whose cost is quadratic in the size of the fleet is the thing that caps the fleet,
which makes it a defect at the orchestration layer's altitude however fast it is today. And the wake-up depended on
the harness re-invoking an agent when a background command exits — an unstated capability only some
harnesses have.

But a session already publishes everything a supervisor needs, unprompted: it appends every transition it
authors to its own log ([[session-timeline]]). Nobody has to carry anything anywhere. **Follow the log.**

## expanded spec

**Following is reading a file past a cursor.** A follower keeps `cursors.json` beside its own record in the
global store: one entry per followed session (plus its own inbox), each naming how far it has read. A
follow costs the follower one `stat` per tick and costs the followed session, the control plane, and the
backend **nothing at all** — so N supervisors watching M agents is N cheap readers, not N×M probes. The
cursor is the only durable state supervision has: a follower that dies and restarts resumes exactly where
it stopped, losing nothing, and there is no registration, no heartbeat, and no TTL to keep alive.

Cursors are also the whole story of *who supervises whom*: A follows B **iff** A's cursors name B. Nothing
records that relationship separately, and nothing needs to — a projection that wants to draw the
supervision network derives it at read time from the cursors of live sessions, exactly as session nesting
derives its tree ([[session-nesting]]). A cursor naming a session whose store dir is gone is dropped the
next time it is read; expiry is a read-time consequence, never a timer.

**Two consumption policies over one subscription:**

- **`spex session wait [SEL…]`** — *take the next event and exit*, an agent's event-loop primitive. It
  follows the selected sessions' logs **and its own inbox**, and returns on the first event past the cursor
  that its filter accepts: a followed session reaching an actionable state, or a message arriving for the
  caller. It prints the observed path on stdout, advances the follow cursor to exactly the event it stopped
  on — never past it, so a second move inside the same tick is still waiting for the next call — and exits;
  the exit is the wake-up. The **inbox** cursor is the one it does not touch: the turn-boundary hook is the
  reader that actually shows a message ([[session-timeline]]), and a wait that advanced it would wake the
  agent for mail the agent is then never given. Exit codes: `0` an event was reached, `1` the deadline
  passed with nothing, `2` a followed session's store is gone. There is no transport outcome, because there
  is no transport: the failure mode that needed its own vocabulary — a backend that could not be reached,
  misread as a session verdict — no longer exists.
- **`spex session watch [SEL…]`** — *stream forever*, for a human. The same follow, emitting every event
  instead of consuming one.

Selection resolves against the **local store**, and a broad follow re-enumerates it every tick so a session
launched mid-follow joins the feed. Where a follow starts is the one place history and news are told apart: a
stored cursor always wins, because that is the resume; with none, a target already present when the follow
began starts at the log's **end** (its past is not an event), while one that appears later has genuinely just
launched and is read from its first line. Each tick costs one `stat` per target — a log that has not grown is
never opened.

`--timeout` (default 1200s) remains the guarantee that `wait` terminates, checked before every sleep, so a
followed session that never moves can never hang the caller. Because a foreground wait still freezes the
caller's turn, a managed-agent shell gets the one-line background-this warning at start, unchanged.

**Edge semantics stay, and become exact.** `wait` returns on a session *entering* an actionable state, not
on it *being* in one — that is what makes "wait for the dispatched merge to actually land" a real signal
rather than an instant false return on the standing `review` level. Reading a log makes this exact where
sampling made it approximate: every transition is a line, so the previous state is a fact rather than
whatever the last poll happened to catch, and two moves in quick succession are two lines rather than one
collapsed observation. A first sighting with no earlier line is an arrival, recorded and narrated, never a
return.

**Starting a follow announces itself.** When a follow starts on a specific live session (not a global
watcher), that session is sent a one-shot message naming its new supervisor and how to reply. It is an
ordinary message — an appended line, like any other ([[session-timeline]]) — fired at most once per target
per follow process, so a stream never re-nags; a one-shot `wait` does not announce.

Nothing here observes liveness, and nothing here can. A log carries only what a session authored
([[state]]), so a follower learns that a session declared, asked, parked, or errored, and never learns that
it died. `offline` is therefore not among the states a follow can reach, where the old poll counted it
actionable — a derived probe result was never a transition anyone authored. Death remains a probe question
owned by that same authored/derived split, answered for the surfaces that genuinely act on it — the board,
the resume guard — and deliberately absent from the supervision path, which must scale.
