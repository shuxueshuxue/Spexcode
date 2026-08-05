---
scenarios:
  - name: zcode-materialize-stop-gate
    description: >
      In a fresh Git repository, run `spex init --harness zcode` and `spex materialize`, then inspect the
      generated `.zcode/settings.json` and hook manifest through the CLI-created project surface.
    expected: >
      Settings contain exactly SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop commands
      baked with the zcode dispatch id; Notification and StopFailure are absent, and Stop retains the blocking
      stop-gate handler.
    tags: [cli]
---

This is the product materialization proof for z-code's supported one-shot surface. Runtime delivery and resume
are intentionally excluded because the adapter refuses those operations without a native control channel.
