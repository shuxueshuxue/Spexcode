---
title: live-matrix
status: active
hue: 280
desc: The eight live behaviors an adapter must show through a real dispatched session — undeclared stop · PreToolUse block · ask · deliver + steer · resume · liveness · commit gate · close — kept as one parameterized list; no test file drives them now.
code:
related:
  - spec-cli/src/harness.ts
---

# live-matrix

[[harness-adapter]]'s acceptance rule — an adapter merges only with per-behavior proof measured through a
REAL dispatched session — is kept here as one parameterized list, so a new harness inherits the same eight
rows instead of re-copying or silently dropping them. No test file drives the rows now: each is shown by
walking a real worker of that harness through the public session verbs (new/send/show/stop/resume/close,
plus a materialize for the transient guard hook and tmux for the liveness kill; never a parallel mechanism)
and handing the transcript, board observations and pane captures to the reviewer as session files.

A harness whose declared runtime semantics intentionally remove a matrix premise does not fake the row.
[[claude-headless]] is record-backed and has ephemeral turn children, so `stop -> offline -> resume` and
`SIGKILL -> offline` are categorically the wrong measurements; its own idle-resume and record-liveness
behaviors replace those two rows while the remaining shared behaviors and its interrupt addition stay live.

## the eight behaviours

[[harness-adapter]] states the acceptance rule this list exists to measure; these are the rows it
parameterizes, each measured through a REAL dispatched session:

1. **undeclared stop** — the gate's rejection reaches the session and the record flows out of `active`.
2. **PreToolUse block** — a blocking hook genuinely stops the tool and the handler's own reason reaches the agent.
3. **ask** — `spex session ask --note` flips the record to `asking` with the note on the board.
4. **deliver + steer** — an idle send lands exactly once (exit 0) and a mid-turn send reaches the live turn.
5. **resume** — stop → resume continues the SAME conversation.
6. **liveness** — a killed agent reads `offline` within seconds, even with a stale socket file on disk, and a
   relaunch reads `online`.
7. **commit gate** — a dirty-tree merge proposal is rejected at settle with the reason delivered into the session.
8. **close** — zero residue: tmux window, process tree, worktree/branch, sockets, session record.

A harness whose runtime shape removes a row's premise supplies a replacement behavior rather than a false
cell. Prompt delivery additionally carries the rerunnable combination campaign — harness form × prompt origin
× delivery timing — whose cells prove native delivery, a readable answer at the requested surface, truthful
liveness, and a landed declaration together; a structural non-cell is BLOCKED, while a runnable cell that
cannot start, exits without a reply, or leaves a stale lifecycle is a FAIL rather than skipped coverage.
