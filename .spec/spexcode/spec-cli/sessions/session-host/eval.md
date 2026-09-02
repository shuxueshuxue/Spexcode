---
scenarios:
  - name: tmux-host-parity
    tags: [backend-api]
    description: >-
      On Linux and macOS, before and after the boundary extraction: dispatch a TUI session and a headless
      session, send a message to each, stop one, quarantine a synthetic unreadable record, and capture every tmux
      invocation (socket, args, timeouts) plus the resulting session records.
    expected: >-
      The captured tmux invocations and the record contents are identical before and after, field for field.
    related: [spec-cli/src/session-tmux.ts, spec-cli/src/sessions.ts]
  - name: process-host-headless-loop
    tags: [backend-api]
    description: >-
      On a host with no tmux on PATH, run `spex serve`, dispatch a headless session, send it a message, let it
      declare, hot-reload the backend by touching a source file, then stop the session.
    expected: >-
      The runtime guard selects process-host and the harness inventory lists only headless adapters; the session
      survives the backend reload and its liveness stays online; stop ends it and the record shows offline.
    related: [spec-cli/src/runtime-guard.ts, spec-cli/src/runtime-ownership.ts]
---
# eval.md - session-host
