---
scenarios:
  - name: handed-over-exactly-once
    tags: [cli]
    description: >-
      Two REAL launched sessions on one board. From the first, `spex session send` a distinctive message to
      the second while that agent is mid-turn (a long tool call in flight), and again while it is idle. Read
      the receiving agent's own transcript for both messages, and read its pending queue afterwards.
    expected: >-
      Each message appears in the receiving transcript EXACTLY ONCE, and as an ordinary prompt — the same
      shape a human's message has, with no injected-context header and no second copy arriving at the next
      turn boundary. This is the regression the node exists for: when a landed handover stopped settling
      the debt, every message arrived twice, once through the adapter and once replayed by a hook. The queue
      is empty afterwards. Sending changes no cursor anywhere.
  - name: owed-until-taken
    tags: [cli]
    description: >-
      Send to a governed session whose harness cannot take the message — stop its runtime first, then send.
      Inspect the log and the queue, then bring the session back with `spex session resume` and watch what
      the agent receives without anyone sending again.
    expected: >-
      The send REPORTS SUCCESS, because acceptance is the durable write and never the reachability of a
      socket. The message is in the log once and owed once. Nothing is lost and nothing is duplicated while
      the session is down. When the runtime returns, the retry sweep hands the message over on its own, in
      the shape of an ordinary prompt, and the queue empties — the agent never had to run a command to find
      its mail, and no turn boundary was needed to trigger it.
  - name: order-survives-refusal
    tags: [cli]
    description: >-
      Queue three messages for a session whose adapter takes the first and then refuses (drive the refusal
      through the real pane state the harness swallows prompts in). Inspect the queue, then clear the
      refusing condition and let the sweep run.
    expected: >-
      The first is handed over and leaves the queue; the pass then STOPS with the second and third still
      queued in the order they were said — a later message is never handed over ahead of an earlier one,
      because order is a property of a conversation. Once the condition clears, the remaining two arrive in
      that same order, each exactly once.
  - name: exactly-once-across-backends
    tags: [cli]
    description: >-
      Two `spex serve` processes over ONE project store, both sweeping. Create a session through the first,
      send to it through the second, then stop its runtime, queue three messages sent alternately through
      both backends, and resume — so both sweeps race to drain the same queue. Count arrivals in the
      receiving agent's transcript and check their order.
    expected: >-
      Every message arrives EXACTLY ONCE and in the order it was said, however many backends are draining:
      the queue's lock, not process ownership, is what makes a handover exactly-once, so a second serve is
      redundancy rather than duplication. Neither backend needs to be the one that launched the session. A
      send made through either reaches the same queue, because delivery state lives in the store, not in a
      process.
  - name: rollout-window-old-sender-new-hook
    tags: [cli]
    description: >-
      The mixed-version window a fleet passes through. Point an OLD-code backend (one whose sendText only
      pokes, without enqueueing) at a session whose worktree has ALREADY materialized the mail-free hook.
      Stop that session's runtime, send one message from the old backend and one from a new one, then resume
      and count arrivals.
    expected: >-
      The new backend's message is queued and handed over exactly once on resume. The old backend's is
      recorded in the log, reports success, and NEVER ARRIVES — nothing enqueued it and the hook that used
      to replay it is gone. This is a real loss window, not a theoretical one, and it names the required
      rollout order: the backend must be upgraded BEFORE a session's hook is re-materialized, never after.
      A deployment that materializes first and restarts second opens exactly this gap.
  - name: old-session-owes-nothing
    tags: [cli]
    description: >-
      Take a session record whose timeline already holds hundreds of `sent` lines from before this mechanism
      existed and that has no pending queue. Start a backend over that store and let the sweep run.
    expected: >-
      Nothing is handed over at all: a queue is only ever filled by an enqueue, so history is never replayed
      as a work list. This is why no backlog migration exists — the old lines stay exactly what they always
      were, a record. A message sent to that same session AFTER the sweep starts is delivered normally.
---

# delivery-queue — yatsu

Measure through two real sessions on a real board, never by importing the module: what is being scored is
what an AGENT received, so the evidence is the receiving side's own transcript, not a return value. Count
occurrences — the failure this node was built to close was silent duplication that read as correct
behaviour because every message did arrive.

The asymmetry worth naming: an entry that leaves the queue too early costs a message the agent never sees,
while one that leaves too late costs only a retry. Every scenario checks that the first failure has no
path — a refusal, a throw, a dead adapter, and a lost process must all leave the debt standing.
