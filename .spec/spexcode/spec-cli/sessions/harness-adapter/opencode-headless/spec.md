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
`opencode run <configured flags> <prompt>` there: `run` is inserted immediately after the launcher executable,
so the seeded `opencode --auto` becomes OpenCode's valid `opencode run --auto`, never the invalid
`opencode --auto run`. OpenCode mints its native session id and the existing plugin reports the first
event through `opencode-capture`. When the turn exits, the pane returns to a shell and the conversation sleeps.
The ordinary output format is used because SpexCode does not scrape stdout; `--format json` is deliberately
absent.

Both the launch turn and every cold wake resolve the configured OpenCode command through the user's login,
interactive shell. That is OpenCode's credential-resolution environment: shell startup may select a provider,
export auth, or redirect the harness's own config/data homes. The adapter reuses that mechanism as a whole; it
does not enumerate credential variable names, copy secrets into the persisted launch script, or hardcode an
auth file path. The runtime's `SHELL` wins; when a service environment omitted it, the adapter uses the account
shell resolved for the backend user rather than silently degrading to `/bin/sh`. Launcher-leading environment
assignments remain scoped to the OpenCode invocation and are present while the shell resolves the command.

The pane wrapper observes the real `opencode run` exit code. A non-zero exit is sent through the shared
[[harness-adapter]] turn-outcome seam before the shell prompt returns, projecting an undeclared active record to
`error` with the code; zero exits and declarations that landed first are not rewritten. A record can stay
`online` only when the headless transport can accept a later wake; the `error` lifecycle exposes the failed turn
rather than hiding it behind the sleeping pane.

Delivery first probes the session's rendezvous socket. During a live turn, the generated plugin owns that
socket, so delivery reuses the existing parse-confirmed `deliverViaRendezvous`; the plugin injects the prompt
through `client.session.prompt` into the active native session. When no listener exists, delivery respawns the
pane with `opencode run --session <harnessSessionId> <prompt>`. If the first event never captured a native id,
the wake uses `--continue`, exactly the interactive adapter's resume fallback. A successful tmux respawn is not
yet a successful delivery: the adapter waits through a bounded early-turn confirmation window. A private,
atomic outcome marker distinguishes a live wrapper pid from a zero/non-zero exit; no marker or a dead wrapper
is failure, never inferred survival. A turn that finishes with zero in that window is accepted, a turn that
exits non-zero is returned as a loud failed delivery after the shared turn-outcome CAS reporter acknowledges
the active-only transition (or the authoritative no-op after a declaration), and a reporter failure is included
in that same delivery error rather than swallowed. A still-running turn is accepted once it survives the
window. Probe/spawn failures are likewise returned loudly and no PTY prompt typing or stdin controller is
introduced. An inconclusive socket probe never starts a possibly duplicate turn.

Liveness is record-backed: while the governed record exists, the adapter reports `online` regardless of tmux,
process, or socket probes. This describes a durable addressable sleeping conversation, not a resident process;
the next delivery is where a missing pane, native conversation, or plugin fails loudly. The adapter declares
`headless: true` and `messageStream: false`: the note conversation is the console trunk, so OpenCode stdout needs
no parallel message collector. Closing remains the terminal operation that removes the record, worktree, tmux
home, and rendezvous residue.
