---
title: opencode-headless
status: active
hue: 155
desc: OpenCode's one-turn `run` form as an independent headless harness: OpenCode-identical materialization, record-backed liveness, rendezvous steering during a live turn, and tmux-homed cold wake while idle.
code:
  - spec-cli/src/opencode-headless.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/opencode.ts
  - spec-cli/src/opencode-headless.test.ts
  - spec-cli/src/sessions-liveness.test.ts
  - spec-cli/src/guide.ts
  - spec-cli/templates/spexcode.json
---

# opencode-headless

## raw source

OpenCode's non-interactive `opencode run` form is an independent [[harness-adapter]] with id
`opencode-headless`, not a mode of the interactive [[opencode-harness]]. It retains OpenCode's generated
plugin and every materialized project surface while replacing the runtime half with ephemeral one-turn
processes.

## expanded spec

The adapter is composed from `opencodeHarness`, retaining its shim, contract, trust, skills, agents, slash
commands, hook events, native-id capture, and `--resume <id>` / `--continue` decision. The headless adapter
changes only its id and runtime capabilities. There is no second plugin generator and no headless branch in
materialize or session product code.

Each governed session keeps one tmux window as the home for its current turn. A fresh launch runs
`opencode run <prompt>` there; OpenCode mints its native session id and the existing plugin reports the first
event through `opencode-capture`. When the turn exits, the pane returns to a shell and the conversation sleeps.
The ordinary output format is used because SpexCode does not scrape stdout; `--format json` is deliberately
absent.

Delivery first probes the session's rendezvous socket. During a live turn, the generated plugin owns that
socket, so delivery reuses the existing parse-confirmed `deliverViaRendezvous`; the plugin injects the prompt
through `client.session.prompt` into the active native session. When no listener exists, delivery respawns the
pane with `opencode run --session <harnessSessionId> <prompt>`. If the first event never captured a native id,
the wake uses `--continue`, exactly the interactive adapter's resume fallback. Spawn/probe failures are returned
loudly and no PTY prompt typing or stdin controller is introduced. An inconclusive socket probe never starts a
possibly duplicate turn.

Liveness is record-backed: while the governed record exists, the adapter reports `online` regardless of tmux,
process, or socket probes. This describes a durable addressable sleeping conversation, not a resident process;
the next delivery is where a missing pane, native conversation, or plugin fails loudly. The adapter declares
`headless: true` and `messageStream: false`: the note conversation is the console trunk, so OpenCode stdout needs
no parallel message collector. Closing remains the terminal operation that removes the record, worktree, tmux
home, and rendezvous residue.
