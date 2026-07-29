---
scenarios:
  - name: turn-boundary-mail-read
    tags: [cli]
    description: >-
      Feed REAL harness payloads through the hook exactly as dispatch.sh does, against a governed session
      record on an ISOLATED store whose timeline.ndjson holds one of the session's own status lines plus two
      `sent` lines — one of them prose that is hostile to any shell that composes JSON (an embedded escaped
      quote, a nested brace, a real newline). Fire the hook, then fire it AGAIN with nothing new, then append
      a third message and fire once more. Separately, count how many child processes the hook spawns on a
      turn with no unread mail versus a turn with mail.
    expected: >-
      The first firing prints both message bodies whole — the JSON-hostile one byte-for-byte, decoded, not
      truncated at its inner quote — and advances the inbox cursor past everything it read. The second
      firing prints NOTHING: a message is shown exactly once, and the session's own status lines are
      consumed rather than returned as mail. The third message is picked up on the next firing. The
      no-mail turn spawns nothing at all (the every-tool-call hot path stays pure bash builtins); a turn
      with mail spawns exactly one writer, `spex internal session-cursor`, because the hook reads the
      cursor file in shell but never rewrites it.
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
