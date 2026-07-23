---
title: codex-headless
status: active
hue: 205
desc: Codex's app-server thread form as an independent headless harness: Codex-identical materialization, record-backed liveness, and direct JSON-RPC turn delivery without a resident TUI process.
code:
  - spec-cli/src/codex-headless.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/codex-headless.test.ts
  - spec-cli/src/sessions-liveness.test.ts
  - spec-cli/templates/spexcode.json

---

# codex-headless

Codex's non-interactive app-server thread form is an independent [[harness-adapter]] with id
`codex-headless`, not a mode of the interactive Codex adapter. It keeps Codex's materialized project surface,
trust, and hook path exactly, while replacing only the visible runtime half.

## expanded spec

The adapter is literal object composition over `codexHarness`: its `.codex` shim and linked-worktree anchor,
`AGENTS.md` contract, skills, trust writer, hook events, slash commands, and bypass-hook-trust thread config are
unchanged. There is no second materializer and no headless branch in materialize or session product code.

The launch command reuses Codex's existing app-server bootstrap and `spex internal codex-launch` path. A fresh
launch starts the stable per-project app-server, calls `thread/start` for the governed worktree, sends the launch
prompt as the first turn, waits for the rollout to persist, and stores the returned thread id. It then exits;
there is deliberately no `codex --remote ... resume` TUI attach and no resident controller in the pane. The
shared app-server remains alive for every thread in the project. Its adapter marks this launch as one-shot so
the generic fast-exit recovery loop does not replay a successful first prompt into a duplicate thread.

Delivery directly reuses Codex's existing app-server JSON-RPC transport. It reads the owned thread and sends
`turn/steer` while a turn is in progress or `turn/start` when the thread is idle, so an idle `spex session send`
starts the next turn without spawning a process or waking a pane. Socket, thread, and RPC failures fail loudly
through the public session API; there is no PTY typing or wake fallback.

When the one-shot first-turn process exits non-zero, the adapter reports that exit through the shared
[[harness-adapter]] turn-outcome seam before returning its failure. An active undeclared record becomes `error`
with the Codex exit code; a zero exit and any declaration already written are left untouched. The shared
app-server remains the liveness address only when it can accept another delivery.

The session record is the liveness address: while it exists, the adapter reports `online` regardless of the
empty pane or process probes. `headless: true` keeps it out of the dashboard launcher picker by default and
`messageStream: false` leaves the note conversation as the console trunk. Resume is deliberately degraded to
the no-TUI form: `resumeArg` is empty because the durable thread already lives in the shared server and there
is no TUI to reattach or restart. Closing remains the terminal operation that
removes the record, worktree, branch, pane, and shared runtime references owned by the session.
