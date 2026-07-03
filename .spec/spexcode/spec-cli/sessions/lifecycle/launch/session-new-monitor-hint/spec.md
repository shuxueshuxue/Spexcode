---
title: session-new-monitor-hint
status: active
hue: 280
desc: A successful launch nudges its caller to actually MONITOR the new session — on stderr, so the JSON stdout stays parseable.
related:
  - spec-cli/src/cli.ts
---

# session-new-monitor-hint

## raw source

Launching a session and then forgetting to watch it is a real gap: the caller — a supervising agent or a
human at a terminal — fires `spex new` / `spex session new`, gets the record, moves on, and the session's
later review / failure / needs-input goes unnoticed because nobody is streaming its lifecycle. So a
successful create must **teach its caller to monitor**, at the moment the caller is looking.

The nudge lives at the **CLI seam** (both `spex new` and its `spex session new` longhand, which share one
create), so it reaches whoever typed the command — the same hint for a human and a dispatched agent, never
baked into one harness.

## expanded spec

After [[launch]] returns the new session record, the CLI prints — to **STDERR** — a short (1–3 line)
monitor reminder carrying the new session **id** and how to watch it. STDERR is the contract: `spex new`
and `spex session new` print the session **JSON to STDOUT**, which callers parse, so the reminder must
never touch stdout or it corrupts that JSON. The hint is calm and useful, not noisy.

It names both monitors, keyed to who is calling when that is cheap to tell (the caller's own-session id,
the same signal [[session-nesting]] reads):

- **`spex watch`** — the canonical live stream of actionable session transitions; the human/interactive
  monitor (and the path a supervising Claude-Code agent turns into a live Monitor).
- background **`spex wait <id>`** — blocks until *this* session hits an actionable status then exits; the
  [[manager-cockpit]] manager loop's per-worker monitor. Surfaced first when the caller is itself an agent.

This node is the **harness-agnostic CLI hint** only — it teaches the reminder, it does not auto-wire any
harness's Monitor tool. Turning `spex watch` into a live Monitor is the agent harness's job, downstream of
the words printed here.
