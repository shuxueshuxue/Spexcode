---
scenarios:
  - name: hook-carries-no-conversation
    tags: [cli]
    description: >-
      Feed REAL harness payloads through the hook exactly as dispatch.sh does, against a governed session
      record on an ISOLATED store whose timeline.ndjson holds one of the session's own status lines plus two
      `sent` lines the session has never been handed, and whose pending queue holds one of them. Fire the
      hook on a prompt-submit payload and on a tool payload, and capture the hook's stdout byte-for-byte.
      Separately, count how many child processes the hook spawns on a turn whose store has unread messages
      and a non-empty queue.
    expected: >-
      The hook's stdout carries NO message text on either firing — not the queued one, not the unqueued one,
      not a header. A message reaches the agent as an ordinary prompt through the adapter
      ([[delivery-queue]]); a hook that also injected it handed every message over twice and made the
      agent's context depend on which of two paths won a race. The pending queue is untouched: this hook is
      not a party to delivery and cannot settle a debt. Freshness still lands — the record flips to
      `active` and a stale note clears. The turn spawns at most the ONE state writer it needs, and none at
      all on the already-active path: no scan of the log, no cursor write, no mail.
  - name: in-process-subagent-tools-preserve-parent-declaration
    tags: [cli]
    description: >-
      Measured YATU on the hook surface itself, with REAL captured payloads: run a real claude session
      that fires a Task subagent under a payload-dumping hook probe, take the captured subagent
      PreToolUse payload (top-level agent_id/agent_type, parent's session_id) and the parent's own
      Bash PreToolUse payload (no agent_id), and feed each byte-for-byte through dispatch.sh into
      mark-active against a governed session record declared `parked` with a note — exactly as the
      harness does. Then fire a real Stop payload through stop-gate on the same record.
    expected: >-
      The subagent-executed tool call leaves the parent's declaration UNTOUCHED — status stays
      `parked`, the note survives — so the following Stop passes the gate (exit 0, no block): a
      supervising parent can hold a declared state while its in-process subagents work. The parent's
      OWN tool call (no agent_id in the payload) still flips the record to `active` and clears the
      note — the freshness signal itself is not weakened. The discriminator is the payload's own
      top-level agent_id key (scanned only in the pre-tool_input prefix, where every string value's
      quotes are JSON-escaped, so tool parameters can never fake it) — deterministic, never a
      heuristic or a timing window.
    code: .spec/spexcode/.plugins/core/mark-active/mark-active.sh
    related: spec-cli/hooks/harness.sh
---
Measured the way dispatch.sh invokes the hook: the captured payload on stdin, SPEXCODE_HARNESS_LIB
sourced, the session resolved through hp_store_dir into a governed session.json. The payloads are
captured live from a real claude session running a real Task subagent (a probe project whose hooks
dump every event's stdin), so the fields measured are the harness's actual contract, not a guess.
