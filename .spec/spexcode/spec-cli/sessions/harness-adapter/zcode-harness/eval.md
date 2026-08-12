---
scenarios:
  - name: zcode-materialize-stop-gate
    description: >
      In a fresh Git repository, run `spex init --harness zcode` and `spex materialize`, then inspect the
      generated `.zcode/settings.json` and hook manifest through the CLI-created project surface.
    expected: >
      The zcode-only seed contains 20 plugin nodes: no idle/idle.sh or session-fail/fail.sh, because their
      Notification and StopFailure events are unavailable. AGENTS.md, distill's zcode skill, and settings remain;
      settings contain exactly SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop commands baked
      with the zcode dispatch id, and the generated Stop command retains the blocking stop-gate handler.
    tags: [cli]
---

This is the product materialization proof for z-code's supported one-shot surface. Runtime delivery and resume
are intentionally excluded because the adapter refuses those operations without a native control channel.
