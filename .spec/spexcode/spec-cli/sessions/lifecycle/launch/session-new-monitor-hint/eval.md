---
scenarios:
  - name: hint-names-monitor-and-comm
    tags: [cli]
    description: >
      Launch a real session with `spex session new`, capturing stdout and stderr separately. Check the stderr
      reminder printed after the create: it must carry the new session id, at least one monitor path
      (`spex session wait <id>` / `spex session watch`), and the comm line (`spex session send <id> "<msg>"` with the warning off
      raw tmux keystrokes). Check stdout in the same run: it must be exactly the parseable session JSON,
      untouched by the reminder.
    expected: |
      Stderr carries all three teachings — monitor (wait/watch, keyed to whether the caller is itself an
      agent), the send comm line, and the anti-tmux-keystroke warning — each naming the real session id.
      Stdout parses as the bare session JSON with no reminder text mixed in.
    code: spec-cli/src/cli.ts
---

# session-new-monitor-hint — yatsu

Measured by running the real `spex new` and reading the two streams a caller actually sees. The loss
being scored is the teach-at-the-moment contract: the caller leaves the create knowing how to watch the
worker AND how to talk to it, and machine callers parsing stdout are never corrupted by the lesson.
