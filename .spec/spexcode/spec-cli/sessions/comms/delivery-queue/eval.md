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
  - name: history-is-not-a-work-list
    tags: [cli]
    description: >-
      Take a session whose timeline holds hundreds of `sent` lines and whose queue is empty. Start a backend
      over that store and let the sweep run.
    expected: >-
      Nothing is handed over at all: a queue is only ever filled by an enqueue, so a log is never read as a
      work list however long it grows. A message sent to that same session AFTER the sweep starts is
      delivered normally.
  - name: close-voids-undelivered-outbound
    tags: [cli, backend-api]
    description: >-
      With two real sessions, make the first send a distinctive `continue` while the second cannot accept
      its prompt, so it remains pending. Close the first through `spex session close`, then restore the
      recipient and wait through several delivery sweeps. Attempt one more `spex session send` from the
      closed session identity through the backend.
    expected: >-
      Neither the pending nor the post-close message reaches the recipient's transcript. The recipient's
      timeline retains the originally accepted message as audit history, but its pending queue progresses
      past the revoked head. The post-close send fails loudly; no stale sender can restart work after close.
  - name: empty-text-is-refused
    tags: [cli, backend-api]
    description: >-
      Attempt `spex session send` with an empty or whitespace-only message, then POST the same text and a
      whitespace-only command to the session input endpoint.
    expected: >-
      The CLI rejects the message before contacting the backend. HTTP returns a structured 400 error for each
      blank body; no timeline event, queue row, or adapter delivery is created.
---

# delivery-queue — yatsu

Measure through two real sessions on a real board, never by importing the module: what is being scored is
what an AGENT received, so the evidence is the receiving side's own transcript, not a return value. Count
occurrences — the failure this node was built to close was silent duplication that read as correct
behaviour because every message did arrive.

The asymmetry worth naming: an entry that leaves the queue too early costs a message the agent never sees,
while one that leaves too late costs only a retry. Every scenario checks that the first failure has no
path — a refusal, a throw, a dead adapter, and a lost process must all leave the debt standing.
