---
scenarios:
  - name: wait-foreground-agent-hint
    tags: [backend-api]
    description: >-
      From a managed-agent shell (a governed session env var present — e.g. SPEXCODE_SESSION_ID), run
      `spex wait <id>` in the FOREGROUND on a non-actionable target with a short --timeout and read the
      command's output from its first moments. Then run the same wait from a plain human shell (no
      session env).
    expected: >-
      The agent-shell wait prints, immediately at start (stderr, one prominent line), a hint that a
      foreground wait freezes the agent's whole turn and that a managed agent should BACKGROUND the wait
      (the exit is the wake-up) — the warning that used to live only in help prose, moved to the point of
      use. Behavior is otherwise unchanged: the wait still runs, still times out / resolves exactly as
      before, exit codes untouched, and the one-line status on resolution stays the only stdout. A human
      shell (no session env) gets NO hint.
---
# yatsu.md — graph

`spex wait` is an agent's event-loop primitive (take-one-and-exit), and a foreground wait freezes the
calling agent's turn — measured through the real CLI from a shell carrying the managed-session env, never
by reasoning about the code.
