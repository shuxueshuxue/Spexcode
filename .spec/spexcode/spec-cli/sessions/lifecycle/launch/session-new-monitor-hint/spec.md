---
title: session-new-monitor-hint
status: active
hue: 280
desc: A successful launch nudges its caller to MONITOR the new session — and names the comm channel (`spex send`) — on stderr, so the JSON stdout stays parseable.
related:
  - spec-cli/src/cli.ts
---

# session-new-monitor-hint

## raw source

Launching a session and then forgetting to watch it is a real gap: the caller — a supervising agent or a
human at a terminal — fires `spex new` / `spex session new`, gets the record, moves on, and the session's
later review / failure / needs-input goes unnoticed because nobody is streaming its lifecycle. So a
successful create must **teach its caller to monitor**, at the moment the caller is looking.

Reaching the worker is the same discoverability gap: `send` sits inside the `session` sub-command
cluster, and a caller who never finds it improvises — the observed failure mode is injecting raw tmux
keystrokes into the worker's pane (field report: gugu-promo coordination, corrected on the spot). So the
same nudge also names the **communication channel**.

The nudge lives at the **CLI seam** (both `spex new` and its `spex session new` longhand, which share one
create), so it reaches whoever typed the command — the same hint for a human and a dispatched agent, never
baked into one harness.

## expanded spec

After [[launch]] returns the new session record, the CLI prints — to **STDERR** — a short (2–4 line)
reminder carrying the new session **id**, how to watch it, and how to reach it. STDERR is the contract:
`spex new` and `spex session new` print the session **JSON to STDOUT**, which callers parse, so the
reminder must never touch stdout or it corrupts that JSON. The hint is calm and useful, not noisy.

It names both monitors, keyed to who is calling when that is cheap to tell (the caller's own-session id,
the same signal [[session-nesting]] reads):

- **`spex watch`** — the canonical live stream of actionable session transitions; the human/interactive
  monitor (and the path a supervising Claude-Code agent turns into a live Monitor).
- background **`spex wait <id>`** — blocks until it observes *this* session transition from non-actionable
  into an actionable status (edge-triggered, [[session-edges]]), then exits printing the observed status
  path; the [[manager-cockpit]] manager loop's per-worker monitor. Surfaced first when the caller is itself
  an agent.

And, for every caller, one **comm line**: `spex send <id> "<msg>"` is how you talk to the worker — with
the explicit warning off raw tmux keystrokes, since that is the dangerous improvisation the line exists
to preempt.

This node is the **harness-agnostic CLI hint** only — it teaches the reminder, it does not auto-wire any
harness's Monitor tool. Turning `spex watch` into a live Monitor is the agent harness's job, downstream of
the words printed here.
