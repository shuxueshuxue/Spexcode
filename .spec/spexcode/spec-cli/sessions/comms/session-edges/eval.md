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
  - name: wait-transport-verdict-distinct
    tags: [backend-api]
    description: >-
      Run `spex wait <id>` against a backend that is unreachable (stopped or firewalled — e.g. `--api` at a
      dead port) with a short --timeout, on a project whose session is healthy (tmux alive). Read stdout,
      stderr, and the exit code. Contrast with the plain-timeout case: backend UP, session alive but never
      actionable, same --timeout.
    expected: >-
      Within its budget the wait RETRIES through the unreachable window (a one-line stderr warn, no verdict).
      A transport failure is NEVER translated into a session state: exhausting the whole budget still
      unreachable exits with a DISTINCT transport-scoped outcome — stdout prints `backend-unreachable` (a
      token outside the session-status vocabulary) and the exit code differs from the plain timeout's — so a
      supervisor reading the one stdout line + exit code can never confuse "I could not reach the board" with
      "the session is offline". `offline` on stdout may only ever relay a successful backend answer that says
      the session's tmux is gone; the plain-timeout contrast case keeps its own distinct exit.
---
# eval.md — graph

`spex wait` is an agent's event-loop primitive (take-one-and-exit), and a foreground wait freezes the
calling agent's turn — measured through the real CLI from a shell carrying the managed-session env, never
by reasoning about the code.
