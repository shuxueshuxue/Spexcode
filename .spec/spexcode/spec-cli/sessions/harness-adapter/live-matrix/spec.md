---
title: live-matrix
status: active
hue: 280
desc: The parameterized harness conformance scenario suite — eight live behaviors exercised by a test file against any registered launcher, filing per-scenario eval readings on that harness's node.
code:
  - spec-cli/scenarios/harness-live-matrix.ts
related:
  - spec-eval/src/filing.ts
  - spec-eval/src/scenarios.ts
  - spec-cli/src/harness.ts
---

# live-matrix

[[harness-adapter]]'s acceptance rule — an adapter merges only with per-behavior readings measured through
a REAL dispatched session — used to live as prose: each harness's eval.md hand-transcribed its own wording
of the eight behaviors and a worker ran them by hand, so every new harness re-copied the matrix or silently
dropped rows. This node keeps that coverage as a parameterized test asset: the behavior contracts live in each
harness's `eval.md` scenarios, while one test file supplies the shared drive and evidence collection. Running
the test against a launcher is a test action, not a new SpexCode CLI verb.

Each scenario carries its contract in `eval.md` and points at the test case that supplies the DRIVE (real
steps over the public session verbs — new/send/show/stop/resume/close, plus a materialize for the transient
guard hook and tmux for the liveness kill; never a parallel mechanism). The test captures EVIDENCE as a
per-scenario transcript of every command, board observation, and pane capture, then files it with the
reading. `spec-cli/scenarios/harness-live-matrix.ts` resolves the launcher to its harness, targets the
`<harness>-harness` spec node (`--node` overrides), and walks ONE real worker through the whole lifecycle:
undeclared-stop · pretooluse-block · ask-note · deliver-steer · resume · liveness · commit-gate ·
close-residue.

The scenario declaration is the contract source: the test resolves the existing canonical name or historical
alias and fails loudly when the harness node has not declared it. It never creates or rewrites `eval.md`.
Adding coverage means adding scenario data and, where needed, a parameterized test case; it does not widen the
CLI or add a harness-specific route.

A harness whose declared runtime semantics intentionally remove a matrix premise does not fake the row.
[[claude-headless]] is record-backed and has ephemeral turn children, so `stop -> offline -> resume` and
`SIGKILL -> offline` are categorically the wrong measurements; its own idle-resume and record-liveness scenarios
replace those two rows while the remaining shared behaviors and its interrupt addition stay live behavior
readings.

Verdicts stay honest three ways: a row that could not be provoked (the worker declared on its own; no
mid-turn window opened) files NOTHING and reports skip — never a fabricated loss signal; a measured row
files pass or fail immediately, so an aborted run keeps its partial readings; and the runner's own board
polling is exactly the probe pressure the delivery path must survive, so the measurement environment is the
adversarial one. A new harness is covered by registering its launcher and adding its scenario data — zero new
CLI code.

## the eight behaviours

[[harness-adapter]] states the acceptance rule this suite exists to measure; these are the rows it parameterizes,
each measured through a REAL dispatched session:

1. **undeclared stop** — the gate's rejection reaches the session and the record flows out of `active`.
2. **PreToolUse block** — a blocking hook genuinely stops the tool and the handler's own reason reaches the agent.
3. **ask** — `spex session ask --note` flips the record to `asking` with the note on the board.
4. **deliver + steer** — an idle send lands exactly once (exit 0) and a mid-turn send reaches the live turn.
5. **resume** — stop → resume continues the SAME conversation.
6. **liveness** — a killed agent reads `offline` within seconds, even with a stale socket file on disk, and a
   relaunch reads `online`.
7. **commit gate** — a dirty-tree merge proposal is rejected at settle with the reason delivered into the session.
8. **close** — zero residue: tmux window, process tree, worktree/branch, sockets, session record.

A harness whose runtime shape removes a row's premise supplies a replacement scenario rather than a false cell,
and each harness node's `eval.md` owns those declarations while [[harness-adapter]] files the aggregate. Prompt
delivery additionally carries the rerunnable combination campaign — harness form × prompt origin × delivery
timing — whose cells prove native delivery, a readable answer at the requested surface, truthful liveness, and a
landed declaration together; a structural non-cell is BLOCKED, while a runnable cell that cannot start, exits
without a reply, or leaves a stale lifecycle is a FAIL rather than skipped coverage.
