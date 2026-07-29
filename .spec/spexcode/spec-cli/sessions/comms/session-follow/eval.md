---
scenarios:
  - name: wait-edge-triggered-return
    tags: [backend-api]
    description: >-
      With a backend up and a session sitting in an ALREADY-actionable declared state (review — a merge
      proposal awaiting its manager), hang `spex session wait <id>` on it. Then drive the session through a
      real merge dispatch: the session's own agent performs the merge (its activity presses the status back
      to working), the merge lands on main, and the closing declaration returns the status to an actionable
      state. Read the wait's full transcript and exit code.
    expected: >-
      The wait prints and records the arrival status (review) immediately but does NOT return on it — an
      already-actionable arrival is not an edge. It returns only upon OBSERVING a transition from a
      non-actionable status into an actionable one (here the post-merge declaration), printing the full
      observed status path on stdout (e.g. review→working→close-pending, last token = the reached status),
      exit 0. Level-triggered instant return on the arrival state is the failure mode this scenario
      reproduces.
  - name: wait-usage-legibility-haiku
    tags: [backend-api]
    description: >-
      Comprehension test of the wait docs by a deliberately small model: give a Haiku-class agent ONLY the
      user-facing wait prose (the `spex help session` wait entry plus the contract block's WAIT bullet and
      the launch monitor reminder) and one real supervision task — "a merge was dispatched for session X,
      currently showing review; report when it has actually landed" — with no coaching. Observe which verb
      it picks, how it runs it, and how it reads the output.
    expected: >-
      From the docs alone the small model picks `spex session wait <id>` (not merge-base polling, not
      blocking on watch), runs it in the BACKGROUND, does not expect an instant return from the
      already-actionable review arrival state (a snapshot need it routes to ls/review instead), and on exit
      reads the printed status path correctly (last token = the state reached). Any misuse means the docs
      are not yet blunt enough — iterate the prose and re-test until the small model uses it right on the
      first try.
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
  - name: follow-costs-the-control-plane-nothing
    tags: [backend-api]
    description: >-
      With N live sessions on the board, start M concurrent `spex session wait` followers on them and let
      them run for a fixed window. Count, for that window, the connects made to the sessions' rendezvous
      control sockets and the tmux processes spawned — measured from outside the followers (socket/process
      accounting), not from their own logs. Contrast against the same N and M before this node's rewrite.
    expected: >-
      Followers make ZERO rendezvous connects and spawn ZERO tmux probes, whatever M is: following reads a
      file past a cursor, so per-observer cost is a stat and the control plane is untouched. The old poll
      made one board build per follower per interval, each carrying a connect per live session — a probe
      rate growing as M×N on a channel where every connect can kick a delivery in flight. This scenario is
      the whole L1 scale claim; a nonzero probe count from a follower is a regression of the node's reason
      to exist.
  - name: delivery-survives-a-dead-kick
    tags: [backend-api]
    description: >-
      Make the target's adapter poke impossible to land (unlink its rendezvous socket, or stop the agent so
      no listener exists), then `spex session send <id> "<text>"` and read the command's exit and output.
      Afterwards bring the agent back to a turn boundary and read what reaches its context.
    expected: >-
      The send SUCCEEDS — delivery is the append, so the bytes are durable regardless of the poke — and the
      line is present in the target's timeline. Nothing reports a false failure and nothing reports a
      delivery that did not happen. At the target's next turn boundary the unread line is injected into its
      context exactly once and the cursor advances, so a message can be late but never lost and never
      doubled. The pre-rewrite failure this replaces: a kicked socket write was the message's only copy.
  - name: one-move-appends-one-line
    tags: [backend-api]
    description: >-
      On a box running several `spex serve` instances that resolve to the SAME project (the ordinary state
      of a dogfood machine — each supervisor hot-reloads its own child), drive one real session through a
      sequence of authored transitions (active → awaiting → active → parked) and read its timeline.ndjson
      raw, without any read-time folding.
    expected: >-
      Each authored move appears EXACTLY ONCE. The measured pre-fix behaviour was one real write plus one
      append per serve instance observing the store — a 1-to-6 amplification that grew linearly with the
      number of backends and was masked by a read-time adjacent-duplicate fold. The log is the delivery and
      the supervision substrate, so a duplicate is not cosmetic: it is a false event for every follower.
      Removing the fold is only honest once this scenario passes with the fold absent.
  - name: follow-needs-no-backend
    tags: [cli]
    description: >-
      With NO `spex serve` running for the project, start `spex session wait <id>` on a session whose agent
      is alive, have that agent declare, and read the wait's stdout and exit code. Also read `spex session
      ls` in the same backend-less shell.
    expected: >-
      The wait returns on the declaration with the observed path and exit 0 — following is reading a file,
      so it needs no daemon and no permission. `ls` answers too, naming its source and reporting liveness
      as `unknown` (no owner may run a probe that perturbs what it measures), and offering no relaunch
      entry off that unknown. Nothing invents a liveness answer and nothing fails merely because no server
      is up.
---
# eval.md — graph

`spex wait` is an agent's event-loop primitive (take-one-event-and-exit, edge-triggered) that follows an
append-only log past a durable cursor. What must be measured through the real CLI, never argued from code:
that a follower costs the control plane nothing, that a message survives a dead poke, that one authored
move leaves exactly one line, and that none of it needs a backend.
