---
title: session-follow
status: active
hue: 280
desc: Supervision is a durable watch relation for governed sessions, delivered through the normal send queue; a log cursor remains the zero-control-plane fallback for a caller that must wait itself.
code:
  - spec-cli/src/session-follow.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-cursors.ts
  - spec-cli/src/session-timeline.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/session-follow.test.ts
  - spec-cli/src/follow-cli.api.test.ts
  - spec-cli/src/session-timeline.test.ts
  - spec-cli/src/session-create-cli.test.ts
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

But a governed supervisor already has a durable address: its ordinary [[dispatch]] queue. Establish that
relationship once, then a target's authored state transition can enter that queue through the same send path
as every other agent message. A caller with no governed address cannot pretend to receive such a delivery; it
waits on the target's log in its own background command instead.

## expanded spec

**`spex session watch <SEL...>` establishes a relation and exits.** When the caller's own session and every
selected target are governed records in the same store, the command adds the caller once to each target's
`watchers.json`. That file, co-located with the target's timeline, is the ONE truth: its authoring path reads
only that small list when it writes a state transition, appends a normal `sent` event to each watcher's
timeline, and enqueues the same ordinary prompt for adapter delivery. A busy or offline watcher therefore
receives the next retry exactly like a normal `spex session send`; an available watcher receives a terminal
insert in its current turn. Installation also sends the target's current authored state, so a relationship
created just after a fast child launch has a truthful starting point.

`spex session watch list` scans targets' `watchers.json` files to show the caller's relations, and
`spex session watch cancel <SEL...>` removes the caller from the selected targets. That scan is a manual
management read, never a transition hot path. There is no second watcher-to-target index, heartbeat, TTL, or
background daemon to reconcile. A removed target takes its watchers file with it; a missing watcher record is
discarded when the target next emits or a list is read.

**The unmanaged fallback is still following.** If the caller has no governed session address, `watch` writes
no unusable subscription and instead names `spex session wait <SEL...>` as the command the harness must run
in the background. A wait is reading a file past `cursors.json` beside its own record: one stat per target per
tick, no tmux, socket, backend, registration, or probe. This is also the explicit escape hatch for a caller
that wants to decide locally when an event is actionable rather than receive every pushed state message.

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
- **`spex session watch stream [SEL…]`** — *stream forever*, for a human. The same follow, emitting every
  event instead of consuming one. It never creates or renews a durable watch relation.

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
