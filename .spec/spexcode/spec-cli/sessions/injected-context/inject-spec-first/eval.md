---
scenarios:
  - name: governed-read-state-machine-across-harness-payloads
    tags: [backend-api]
    test:
      path: spec-cli/src/hook-dispatch.test.ts
      name: spec-first
    description: >-
      Through the real dispatch.sh + spec-first.sh + `spex internal spec-governors` path in a temporary governed project,
      run the same sequences with Claude-shaped Read payloads and Codex-shaped Bash-read payloads: ungoverned
      then governed, repeated ungoverned then governed, and governed-first then governed retry. Also deliver a
      governed mutation through the event-wide PreToolUse hook before the governed read.
    expected: >-
      Ungoverned reads and non-read events exit 0 without creating `spec-checked`, no matter how many arrive.
      The first later governed read exits 2 exactly once, creates the sentinel, names the actual governor, and
      directs the agent to relevant neighbors; its retry and every later read pass. Claude and Codex have the
      same state transitions from one handler and differ only in the adapter's payload matcher.
---
# eval.md — spec-first

The loss watched here is the gate's state boundary: only a read whose path resolves to a real `code:` governor
may consume the session's one shot. The scenario uses the real dispatcher, adapter shell mirror, hook, and CLI
governor resolver rather than a stub, and runs both native payload shapes against the same sequence table.
