---
scenarios:
  - name: opencode-headless-record-liveness
    description: Launch a real governed opencode-headless session, wait for its first turn to exit, and inspect the public session state while the turn process and rendezvous listener are absent.
    expected: The intact session record remains online and its terminal-free conversation stays available while the native conversation sleeps.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-idle-wake
    description: Send a note-backed prompt to the real governed session after its first turn exits and capture the public send/result plus the model reply.
    expected: Delivery starts exactly one `opencode run --session <captured-id> <prompt>` turn in the session tmux home and the real model answers in the same conversation.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-live-steer
    description: While a real opencode-headless turn is running with its plugin rendezvous socket bound, send a second prompt through the public session send surface.
    expected: The existing parse-confirmed rendezvous transport accepts the prompt exactly once through `client.session.prompt`; no second turn process or PTY input bridge is used.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
  - name: opencode-headless-fail-loud
    description: Remove the session's turn home, then send a prompt through the public session send surface.
    expected: Delivery returns a non-success result naming the failed wake; it never records a sent message or silently falls back to terminal typing.
    tags: [backend-api, cli]
    code: [spec-cli/src/opencode-headless.ts]
---

Measure through one real `opencode-headless` launcher and the public `spex session` verbs. Store the command,
board, and model-reply transcript as result evidence; source inspection and unit tests are auxiliary only.
