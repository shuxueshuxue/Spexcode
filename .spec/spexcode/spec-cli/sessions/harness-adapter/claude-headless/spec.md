---
title: claude-headless
status: active
hue: 275
desc: Claude Code's stream-json headless form as an independent harness adapter: Claude-identical materialization, a controller-owned turn process, record-backed liveness, native-event message streaming, and fail-loud control.
code:
  - spec-cli/src/claude-headless.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessions.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/index.ts
  - spec-cli/src/client.ts
  - spec-cli/src/help.ts
  - spec-cli/src/claude-headless.test.ts
  - spec-cli/src/sessions-liveness.test.ts
  - spec-cli/templates/spexcode.json
---

# claude-headless

## raw source

Claude's non-interactive `-p` stream-json form is a fifth, independent [[harness-adapter]] with id
`claude-headless`, not a mode of the interactive Claude adapter. Its materialized project surface is exactly
Claude's surface; its runtime is not: turns are controlled through the native stream-json stdin/stdout protocol,
and every native output event is made available to message-stream consumers without translation.

## expanded spec

The adapter is composed from `claudeHarness`, retaining Claude's shim, contract, trust, skills, agents, slash
commands, hook events, session-id flag, and commit-attribution behavior. That reuse is literal object composition:
the headless adapter changes only its id and runtime half. The shared `.claude` artifacts are therefore written,
cleaned, and trusted by the already-proven Claude mechanism; there is no second materializer and no headless mode
branch in product code.

Each governed session still owns one tmux window, but the window houses a small controller rather than a TUI. The
controller owns the stream-json child and a short per-session control socket. A fresh launch starts
`claude -p --session-id <id> --input-format stream-json --output-format stream-json --verbose`; after a completed
turn the child exits and the controller remains. Delivery while a turn is active writes a native `type:user`
event to that live child's stdin, so Claude injects it at the next tool boundary. Delivery while idle spawns
`claude -p --resume <id> --input-format stream-json --output-format stream-json --verbose` and writes the prompt
as its first native input event. Spawn, connect, stream-write, and early-child failures are returned loudly; no
PTY prompt typing fallback exists.

Hard interrupt is the native stream-json `control_request` with request subtype `interrupt`. The controller waits
for the matching `control_response` before confirming it, and the interrupted child remains able to accept later
conversation. This control is exposed through the same session backend/CLI broker as other remote control, so the
backend remains the single actor and a remote manager never reaches into tmux directly.

Every complete stdout line from every turn child is appended byte-for-byte as one Claude-native JSON event to
`messages.ndjson` in the session's global store directory. No SpexCode envelope, timestamp, or renamed field is
added. The same bytes are mirrored to the controller's stdout, preserving the existing tmux capture and reaper
pipeline while a separate message-stream consumer can tail the durable file. Partial/non-line output is never
presented as an event.

Liveness is deliberately record-backed: while the session record exists, the adapter answers `online` regardless
of controller, tmux, or child-process probes. This is a statement about the durable addressable session, not a
claim that a turn process is resident. A broken/missing controller is surfaced by the next deliver or interrupt
as a loud transport failure; it is never converted into a speculative `offline`. Closing the session remains the
terminal operation that removes the record, worktree, tmux home, control socket, and message stream.

The controller reports every non-zero turn-child exit through the shared [[harness-adapter]] turn-outcome seam. If
the record is still `active`, that exit projects lifecycle `error` with the Claude headless exit code; a zero exit
is inert and a declaration that landed before child teardown wins the compare-and-set. The record may remain
`online` because this controller can still accept another delivery; `error` is the visible fact that the previous
turn died.
